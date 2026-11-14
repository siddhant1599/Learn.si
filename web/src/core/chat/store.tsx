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

import { CHAT_PREFIX, DELETED_PREFIX, readChats, restoreSettings, saveChat, markChatDeleted } from "./cache";
import { chatAdapter } from "./adapter";

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
  /** False until browser storage has been read, on the client only. */
  ready: boolean;
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

function titleFromPrompt(text: string) {
  return text.length > 60 ? `${text.slice(0, 60).trimEnd()}…` : text;
}

/** A reload cannot resume a stream, so a saved running turn reads as stopped. */
function settleInterruptedTurn(thread: ChatThread): ChatThread {
  return {
    ...thread,
    messages: thread.messages.map((message) =>
      message.role === "assistant" && message.status === "streaming"
        ? finishAssistantMessage(message, "stopped", 0)
        : message,
    ),
  };
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

  const owned = useRef(new Set<string>());
  const forget = useCallback((id: string) => {
    removed.current.add(id);
    controllers.current.get(id)?.abort();
    owned.current.delete(id);
    try { markChatDeleted(localStorage, id); } catch { /* server tombstone remains authoritative */ }
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
    if (serverId) await requestDelete(`conversations/${serverId}`);
    else {
      try { markChatDeleted(localStorage, id); }
      catch { throw new Error("Browser storage is unavailable. Chat deletion could not be saved; please retry."); }
    }
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
  useEffect(() => {
    const restore = () => {
      try {
        const { threads: saved, invalid } = readChats(localStorage);
        const restored = saved.map(settleInterruptedTurn);
        setThreads(current => {
          const incoming = new Map(restored.map(t => [t.id, t]));
          // A local in-flight turn wins over external updates until it settles.
          for (const t of current) {
            if (localStorage.getItem(DELETED_PREFIX + t.id)) {
              controllers.current.get(t.id)?.abort();
              owned.current.delete(t.id);
              removed.current.add(t.id);
              if (window.location.pathname === `/workspace/chats/${t.id}`) history.replaceState(null, "", "/workspace/chats/new");
            } else if (owned.current.has(t.id)) incoming.set(t.id, t);
          }
          return [...incoming.values()].sort((a,b) => b.updatedAt-a.updatedAt || a.id.localeCompare(b.id));
        });
        if (invalid) toast.error("Some saved chats could not be restored. Valid chats remain available; the original cache was preserved.");
      } catch {
        // Blocked storage must not make the in-memory workspace unusable.
      }
    };
    restore();
    setSettings(current => restoreSettings(readJson<unknown>(SETTINGS_KEY), current));
    setReady(true);
    const changed = (event: StorageEvent) => {
      if (event.key === null || (event.key.startsWith(CHAT_PREFIX) || event.key.startsWith(DELETED_PREFIX))) restore();
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, []);

  useEffect(() => {
    if (!ready) return;
    for (const thread of threads) {
      if (!owned.current.has(thread.id) || streamingIds.has(thread.id)) continue;
      try {
        if (!saveChat(localStorage, thread)) {
          setThreads(current => current.filter(t => t.id !== thread.id));
          toast.error("This chat was deleted in another tab.");
        }
      } catch {
        toast.error("Chat could not be saved in this browser. It remains available in this tab.");
        continue;
      }
      owned.current.delete(thread.id);
    }
  }, [ready, streamingIds, threads]);

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

      owned.current.add(threadId);
      setThreads((current) => {
        const next: ChatThread = {
          id: threadId,
          documentIds,
          serverThreadId: existing?.serverThreadId,
          title: existing?.title ?? titleFromPrompt(text),
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
              serverThreadId: existing?.serverThreadId,
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
