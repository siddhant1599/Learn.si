"use client";

import { nanoid } from "nanoid";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";

import { site } from "@/config/site";

import { restoreSettings } from "./cache";
import { chatAdapter } from "./adapter";
import { chatTitle, fetchChatList, fetchChatMessages, importLocalChats, summaryThread } from "./server";

import {
  applyChatEvent,
  finishAssistantMessage,
  updateAssistantMessage,
} from "./reducer";
import type { ChatMessage, ChatSettings, ChatThread } from "./types";
import { usePathname } from "next/navigation";
import { modeFromPathname } from "@/core/workspace/mode";

const SETTINGS_KEY = "document-lab.settings";

const DEFAULT_SETTINGS: ChatSettings = {
  depth: "pro",
  model: site.chat.models[0]!.name,
};

type SendInput = {
  threadId: string;
  text: string;
  files: File[];
};

type Deletion = { kind: "document" | "conversation" | "course"; id: string; pending: boolean };

type ChatStore = {
  deletions: Deletion[];
  deleteChat: (id: string) => Promise<void>;
  deleteDocument: (id: string) => Promise<void>;
  /** False until the server's chat list has been requested (loaded or failed). */
  ready: boolean;
  /** Why the chat list could not be loaded, if it could not. */
  chatsError: string;
  /** Load a listed chat's messages from the server. */
  loadThread: (id: string) => Promise<void>;
  webAvailable: boolean | null;
  documents: { id: string; title: string; edition: string }[];
  selectedIds: string[];
  setSelectedIds: (ids: string[]) => void;
  refreshDocuments: () => Promise<void>;
  documentsError: string;
  threads: ChatThread[];
  settings: ChatSettings;
  setSettings: (settings: ChatSettings) => void;
  isStreaming: (threadId: string) => boolean;
  send: (input: SendInput) => void;
  stop: (threadId: string) => void;
};

const ChatStoreContext = createContext<ChatStore | null>(null);

export function useChatStore() {
  const store = useContext(ChatStoreContext);
  if (!store) {
    throw new Error("useChatStore must be used within ChatStoreProvider");
  }
  return store;
}

function readJson<T>(key: string): T | undefined {
  try {
    const value = localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : undefined;
  } catch {
    return undefined;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage may be full or blocked; the session still works in memory.
  }
}

/**
 * Combine the server's chat list with chats already in memory. A chat whose messages are
 * loaded (or being written in this tab) keeps them; the list adds new chats and updates
 * titles and order. Chats removed here stay removed.
 */
function mergeChats(current: ChatThread[], listed: ChatThread[], removed: Set<string>): ChatThread[] {
  const byId = new Map(current.map((t) => [t.id, t]));
  for (const incoming of listed) {
    const known = byId.get(incoming.id);
    byId.set(incoming.id, known && known.loaded !== false
      ? { ...known, documentIds: known.documentIds ?? incoming.documentIds, updatedAt: Math.max(known.updatedAt, incoming.updatedAt) }
      : incoming);
  }
  return [...byId.values()]
    .filter((t) => !removed.has(t.id))
    .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
}

export function ChatStoreProvider({ children }: { children: ReactNode }) {
  const [deletions, setDeletions] = useState<Deletion[]>([]);
  const removed = useRef(new Set<string>());
  const sessions = useRef(new Map<string, string>());
  const [webAvailable, setWebAvailable] = useState<boolean | null>(null);
  const [ready, setReady] = useState(false);
  const [documents, setDocuments] = useState<
    { id: string; title: string; edition: string }[]
  >([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [documentsError, setDocumentsError] = useState("");
  const refreshDocuments = useCallback(async () => {
    try {
      const r = await fetch("/api/rag/documents", {
        signal: AbortSignal.timeout(20000),
      });
      if (!r.ok)
        throw new Error("Cannot load documents. Check the backend connection.");
      setDocuments(await r.json());
      setDocumentsError("");
    } catch (e) {
      setDocumentsError(
        e instanceof Error ? e.message : "Unable to load documents.",
      );
    }
  }, []);
  useEffect(() => {
    void refreshDocuments();
  }, [refreshDocuments]);
  // Web availability only matters to Ask-mode chat; Master pages skip the probe.
  const inAsk = modeFromPathname(usePathname()) === "ask";
  const probedHealth = useRef(false);
  useEffect(() => {
    if (!inAsk || probedHealth.current) return;
    probedHealth.current = true;
    void fetch("/api/rag/health", { signal: AbortSignal.timeout(10000) })
      .then(r => r.json()).then(data => setWebAvailable(data.web_available === true))
      .catch(() => setWebAvailable(null));
  }, [inAsk]);
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [streamingIds, setStreamingIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const controllers = useRef(new Map<string, AbortController>());
  const threadsRef = useRef(threads);
  threadsRef.current = threads;

  const [chatsError, setChatsError] = useState("");
  const forget = useCallback((id: string) => {
    removed.current.add(id);
    controllers.current.get(id)?.abort();
    setThreads(current => current.filter(t => t.id !== id));
    if (window.location.pathname === `/workspace/chats/${id}`) history.replaceState(null, "", "/workspace/chats/new");
  }, []);
  const syncDeletions = useCallback(async () => {
    const response = await fetch("/api/rag/deletions", { signal: AbortSignal.timeout(10000), cache: "no-store" });
    if (!response.ok) return;
    const data: Deletion[] = await response.json();
    if (!Array.isArray(data)) return;
    setDeletions(data);
    const docs = new Set(data.filter(d => d.kind === "document").map(d => d.id));
    setSelectedIds(ids => ids.filter(id => !docs.has(id)));
    setDocuments(current => current.filter(d => !docs.has(d.id)));
    for (const t of threadsRef.current) {
      if (data.some(d => d.kind === "conversation" && d.id === (t.serverThreadId ?? sessions.current.get(t.id)))) forget(t.id);
      else if (t.documentIds?.some(id => docs.has(id))) controllers.current.get(t.id)?.abort();
    }
  }, [forget]);
  useEffect(() => {
    const sync = () => { void syncDeletions().catch(() => {}); };
    sync();
    const timer = setInterval(sync, 5000);
    window.addEventListener("focus", sync);
    return () => { clearInterval(timer); window.removeEventListener("focus", sync); };
  }, [syncDeletions]);
  useEffect(() => {
    for (const thread of threads) {
      if (deletions.some(d => d.kind === "conversation" && d.id === thread.serverThreadId)) forget(thread.id);
    }
  }, [deletions, threads, forget]);
  const requestDelete = useCallback(async (path: string) => {
    const response = await fetch(`/api/rag/${path}`, { method: "DELETE", signal: AbortSignal.timeout(20000) });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(typeof body.detail === "string" ? body.detail : "Deletion failed. Please retry.");
    }
    return response.json();
  }, []);
  const deleteChat = useCallback(async (id: string) => {
    controllers.current.get(id)?.abort();
    const thread = threadsRef.current.find(t => t.id === id);
    const serverId = thread?.serverThreadId ?? sessions.current.get(id);
    // A chat that never reached the server exists only in this tab.
    if (serverId) await requestDelete(`conversations/${serverId}`);
    forget(id);
    toast.success("Chat deleted. Source documents were kept.");
  }, [forget, requestDelete]);
  const deleteDocument = useCallback(async (id: string) => {
    const result = await requestDelete(`documents/${id}`);
    setDeletions(current => [...current.filter(d => d.id !== id), {kind: "document", id, pending: result.status === "cleanup_pending"}]);
    setDocuments(current => current.filter(d => d.id !== id));
    setSelectedIds(current => current.filter(value => value !== id));
    for (const t of threadsRef.current) if (t.documentIds?.includes(id)) controllers.current.get(t.id)?.abort();
    if (result.status === "cleanup_pending") toast.message("Source removed. External cleanup is pending; retry is available in Sources.");
    else toast.success("Document deleted. Historical answers were kept.");
  }, [requestDelete]);
  // Chats come from the server, so every device shows the same list. Older builds kept
  // chats in this browser: their steps are uploaded once, then the local copies go.
  const refreshChats = useCallback(async () => {
    const listed = (await fetchChatList()).map(summaryThread);
    setThreads((current) => mergeChats(current, listed, removed.current));
    setChatsError("");
  }, []);
  useEffect(() => {
    setSettings(current => restoreSettings(readJson<unknown>(SETTINGS_KEY), current));
    let live = true;
    void (async () => {
      try { await importLocalChats(localStorage); } catch { /* retried on the next visit */ }
      try { await refreshChats(); }
      catch (e) { if (live) setChatsError(e instanceof Error ? e.message : "Chats could not be loaded."); }
      finally { if (live) setReady(true); }
    })();
    // Other tabs and devices add chats; pick them up when this tab regains focus.
    const onFocus = () => { void refreshChats().catch(() => {}); };
    window.addEventListener("focus", onFocus);
    return () => { live = false; window.removeEventListener("focus", onFocus); };
  }, [refreshChats]);

  const loading = useRef(new Set<string>());
  const loadThread = useCallback(async (id: string) => {
    if (loading.current.has(id)) return;
    loading.current.add(id);
    try {
      const messages = await fetchChatMessages(id);
      setThreads((current) => messages === null
        ? current.filter((t) => t.id !== id)
        : current.map((t) => t.id === id && t.loaded === false
            ? { ...t, messages, loaded: true, loadError: undefined } : t));
    } catch (e) {
      const loadError = e instanceof Error ? e.message : "This chat could not be loaded.";
      setThreads((current) => current.map((t) => t.id === id ? { ...t, loadError } : t));
    } finally {
      loading.current.delete(id);
    }
  }, []);

  useEffect(() => {
    if (ready) writeJson(SETTINGS_KEY, settings);
  }, [ready, settings]);

  const updateThread = useCallback(
    (threadId: string, update: (thread: ChatThread) => ChatThread) => {
      setThreads((current) =>
        current.map((thread) =>
          thread.id === threadId ? update(thread) : thread,
        ),
      );
    },
    [],
  );

  const stop = useCallback((threadId: string) => {
    controllers.current.get(threadId)?.abort();
  }, []);

  const send = useCallback(
    ({ threadId, text, files }: SendInput) => {
      if (controllers.current.has(threadId) || removed.current.has(threadId)) return;

      const userMessage: ChatMessage = {
        id: nanoid(),
        role: "user",
        text,
        files: files.map((file) => file.name),
      };
      const assistantId = nanoid();
      const existing = threadsRef.current.find(
        (thread) => thread.id === threadId,
      );
      const documentIds = existing?.documentIds ?? selectedIds;
      // The server knows the chat once an answer was saved; until then (a first question,
      // or a retry after it failed) the server creates it under this tab's id.
      const saved = existing?.messages.some((m) => m.role === "assistant" && m.status === "complete");
      if (documentIds.some(id => deletions.some(d => d.kind === "document" && d.id === id))) {
        throw new Error("A source was deleted. Start a new chat with available sources.");
      }
      if (!documentIds.length) {
        toast.error("Select a document in the sidebar before sending.");
        throw new Error("Select a document first.");
      }
      if (text.length > 4000) {
        toast.error("Questions can contain up to 4,000 characters.");
        throw new Error("Question too long");
      }
      const messages = [...(existing?.messages ?? []), userMessage];

      setThreads((current) => {
        const next: ChatThread = {
          id: threadId,
          documentIds,
          serverThreadId: existing?.serverThreadId,
          loaded: true,
          title: existing?.title ?? chatTitle(text),
          todos: [],
          updatedAt: Date.now(),
          messages: [
            ...messages,
            {
              id: assistantId,
              role: "assistant",
              reasoning: "",
              steps: [],
              text: "",
              status: "streaming",
            },
          ],
        };
        return [next, ...current.filter((thread) => thread.id !== threadId)];
      });

      const controller = new AbortController();
      controllers.current.set(threadId, controller);
      setStreamingIds((current) => new Set(current).add(threadId));
      const startedAt = Date.now();

      const finish = (status: "complete" | "stopped" | "error") => {
        const durationSeconds = Math.round((Date.now() - startedAt) / 1000);
        updateThread(threadId, (thread) =>
          updateAssistantMessage(thread, assistantId, (message) =>
            finishAssistantMessage(message, status, durationSeconds),
          ),
        );
        controllers.current.delete(threadId);
        setStreamingIds((current) => {
          const next = new Set(current);
          next.delete(threadId);
          return next;
        });
      };

      void (async () => {
        try {
          const events = chatAdapter.stream(
            {
              threadId,
              messages,
              files,
              settings,
              documentIds,
              serverThreadId: saved ? existing?.serverThreadId ?? threadId : undefined,
              newThreadId: saved ? undefined : threadId,
            },
            controller.signal,
          );
          for await (const event of events) {
            if (event.type === "session") {
              sessions.current.set(threadId, event.serverThreadId);
              if (removed.current.has(threadId)) {
                await requestDelete(`conversations/${event.serverThreadId}`);
                continue;
              }
            }
            if (removed.current.has(threadId)) continue;
            updateThread(threadId, (thread) =>
              applyChatEvent(thread, assistantId, event),
            );
          }
          finish("complete");
        } catch (error) {
          if (controller.signal.aborted) {
            finish("stopped");
            return;
          }
          const detail =
            error instanceof Error
              ? error.message
              : "The response failed. Try again.";
          toast.error(detail);
          updateThread(threadId, (thread) =>
            updateAssistantMessage(thread, assistantId, (message) => ({
              ...message,
              error: detail,
            })),
          );
          finish("error");
        }
      })();
    },
    [settings, updateThread, selectedIds, deletions, requestDelete],
  );

  const isStreaming = useCallback(
    (threadId: string) => streamingIds.has(threadId),
    [streamingIds],
  );

  const value = useMemo(
    () => ({
      deletions, deleteChat, deleteDocument,
      ready,
      chatsError,
      loadThread,
      webAvailable,
      documents,
      selectedIds,
      setSelectedIds,
      refreshDocuments,
      documentsError,
      threads,
      settings,
      setSettings,
      isStreaming,
      send,
      stop,
    }),
    [
      deletions, deleteChat, deleteDocument,
      ready,
      chatsError,
      loadThread,
      webAvailable,
      threads,
      settings,
      isStreaming,
      send,
      stop,
      documents,
      selectedIds,
      refreshDocuments,
      documentsError,
    ],
  );

  return (
    <ChatStoreContext.Provider value={value}>
      {children}
    </ChatStoreContext.Provider>
  );
}
