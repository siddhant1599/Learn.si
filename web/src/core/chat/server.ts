/**
 * Ask chats live on the server (PostgreSQL), so every device shows the same chats.
 * This module loads the chat list and a chat's messages, rebuilds each answer's
 * activity steps, and moves chats that older builds kept in this browser to the server.
 */
import { CHAT_PREFIX, DELETED_PREFIX, readChats } from "./cache";
import { progressStep } from "./progress";
import type { ChatMessage, ChatStep, ChatThread, Citation } from "./types";

/** Marks that this browser's old local chats were handed to the server. */
export const LOCAL_CHATS_IMPORTED_KEY = "learn-si.chats-imported";
const LEGACY_THREADS_KEY = "document-lab.threads";
const PAGE = 50;

export type ChatSummary = {
  id: string;
  title: string;
  document_ids: string[];
  updated_at: string;
  message_count: number;
};

type ServerMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  steps?: unknown[];
  warnings?: unknown[];
};

export function chatTitle(text: string) {
  return text.length > 60 ? `${text.slice(0, 60).trimEnd()}…` : text;
}

/** A sidebar entry for a chat whose messages have not been loaded yet. */
export function summaryThread(summary: ChatSummary): ChatThread {
  const updatedAt = Date.parse(summary.updated_at);
  return {
    id: summary.id,
    serverThreadId: summary.id,
    documentIds: summary.document_ids,
    title: chatTitle(summary.title),
    messages: [],
    todos: [],
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0,
    loaded: false,
  };
}

const KINDS = new Set(["search", "fetch", "bash", "write"]);
const STATUSES = new Set(["active", "complete", "failed", "stopped"]);

/**
 * Saved steps are either progress events recorded by the server (`step` field) or steps
 * an older browser uploaded once (`label` field). A saved step can't still be running.
 */
export function savedStep(value: unknown): ChatStep | undefined {
  if (!value || typeof value !== "object") return;
  const v = value as Record<string, unknown>;
  let step: ChatStep | undefined;
  if (typeof v.step === "string") step = progressStep(v);
  else if (typeof v.id === "string" && typeof v.label === "string"
    && KINDS.has(v.kind as string) && STATUSES.has(v.status as string)) {
    step = {
      id: v.id, label: v.label, kind: v.kind as ChatStep["kind"], status: v.status as ChatStep["status"],
      ...(Array.isArray(v.results) ? { results: v.results.filter((r): r is string => typeof r === "string") } : {}),
      ...(typeof v.parent === "string" ? { parent: v.parent } : {}),
    };
  }
  if (step?.status === "active") step = { ...step, status: "stopped" };
  return step;
}

export function serverMessages(rows: ServerMessage[]): ChatMessage[] {
  return rows.filter((m) => m && typeof m.content === "string").map((m) =>
    m.role === "user"
      ? { id: `s${m.id}`, role: "user", text: m.content, files: [] }
      : {
          id: `s${m.id}`,
          role: "assistant",
          text: m.content,
          reasoning: "",
          status: "complete",
          citations: Array.isArray(m.citations) ? m.citations : [],
          warnings: Array.isArray(m.warnings) ? m.warnings.filter((w): w is string => typeof w === "string") : [],
          steps: (Array.isArray(m.steps) ? m.steps : []).map(savedStep).filter((s): s is ChatStep => !!s),
        },
  );
}

export async function fetchChatList(signal?: AbortSignal): Promise<ChatSummary[]> {
  const response = await fetch("/api/rag/conversations", { cache: "no-store", signal });
  if (!response.ok) throw new Error("Chats could not be loaded. Check the backend connection.");
  const data: unknown = await response.json();
  return Array.isArray(data)
    ? data.filter((c): c is ChatSummary => !!c && typeof c.id === "string" && typeof c.title === "string"
        && Array.isArray(c.document_ids))
    : [];
}

/** Every saved message of a chat, oldest first; `null` when the chat does not exist. */
export async function fetchChatMessages(id: string, signal?: AbortSignal): Promise<ChatMessage[] | null> {
  const rows: ServerMessage[] = [];
  let before: number | undefined;
  for (let page = 0; page < 100; page++) {
    const query = new URLSearchParams({ limit: String(PAGE), ...(before ? { before: String(before) } : {}) });
    const response = await fetch(`/api/rag/conversations/${encodeURIComponent(id)}/messages?${query}`, {
      cache: "no-store", signal,
    });
    if (response.status === 404 || response.status === 422) return null;
    if (!response.ok) throw new Error("This chat could not be loaded. Check the backend connection.");
    const batch: ServerMessage[] = await response.json();
    if (!Array.isArray(batch) || !batch.length) break;
    rows.unshift(...batch);
    if (batch.length < PAGE) break;
    before = batch[0]!.id;
  }
  return serverMessages(rows);
}

/**
 * One time per browser: upload the activity steps of chats that older builds kept in
 * browser storage (their questions and answers are already on the server), then remove
 * those local copies. Chats that never reached the server have nothing to attach to.
 */
export async function importLocalChats(storage: Storage): Promise<number> {
  if (storage.getItem(LOCAL_CHATS_IMPORTED_KEY)) return 0;
  const { threads } = readChats(storage);
  const retry = new Set<string>();
  let imported = 0;
  for (const thread of threads) {
    const server = thread.serverThreadId;
    const answers = thread.messages.flatMap((m) =>
      m.role === "assistant" && m.status === "complete" && m.steps.length
        ? [{ content: m.text, warnings: m.warnings ?? [], steps: m.steps }] : []);
    if (server && answers.length) {
      const response = await fetch(`/api/rag/conversations/${encodeURIComponent(server)}/import-steps`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answers }),
      });
      // Keep the local copy for a later retry unless the server answered for good.
      if (!response.ok && response.status !== 404) { retry.add(CHAT_PREFIX + thread.id); continue; }
      imported += 1;
    }
    storage.removeItem(CHAT_PREFIX + thread.id);
  }
  // Unreadable old copies and deletion markers have nothing left to move.
  for (let i = storage.length - 1; i >= 0; i--) {
    const key = storage.key(i);
    if (key && (key.startsWith(DELETED_PREFIX) || (key.startsWith(CHAT_PREFIX) && !retry.has(key)))) {
      storage.removeItem(key);
    }
  }
  storage.removeItem(LEGACY_THREADS_KEY);
  if (!retry.size) storage.setItem(LOCAL_CHATS_IMPORTED_KEY, new Date().toISOString());
  return imported;
}
