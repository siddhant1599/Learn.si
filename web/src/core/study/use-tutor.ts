"use client";

import { nanoid } from "nanoid";
import { useCallback, useEffect, useRef, useState } from "react";

import { site } from "@/config/site";
import { chatAdapter } from "@/core/chat/adapter";
import { applyChatEvent, finishAssistantMessage, updateAssistantMessage } from "@/core/chat/reducer";
import type { ChatMessage, ChatThread, Citation } from "@/core/chat/types";

import { tutorApi } from "./api";
import type { TutorHistory } from "./types";

const SETTINGS = { depth: "pro" as const, model: site.chat.models[0]!.name };

export function historyMessages(history: TutorHistory): ChatMessage[] {
  if (!history || !Array.isArray(history.messages)) return [];
  return history.messages.filter((m) => m && typeof m.content === "string").map((m) =>
    m.role === "user"
      ? { id: `h${m.id}`, role: "user", text: m.content, files: [] }
      : {
          id: `h${m.id}`, role: "assistant", text: m.content, reasoning: "", steps: [],
          status: "complete", citations: m.citations as Citation[],
        },
  );
}

/**
 * The lesson's tutor chat: history from the server-bound conversation, turns
 * through the same SSE adapter as Ask with lesson_id (document-only, no web).
 * Nothing is written to browser storage; the server conversation is the record.
 */
export function useTutor(lessonId: string, documentId: string) {
  const [thread, setThread] = useState<ChatThread>({
    id: `lesson-${lessonId}`, title: "Tutor", messages: [], todos: [], updatedAt: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [streaming, setStreaming] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const threadRef = useRef(thread);
  threadRef.current = thread;

  useEffect(() => {
    let live = true;
    tutorApi.history(lessonId)
      .then((history) => {
        if (!live) return;
        // Map outside the state updater so a malformed reply can never break rendering.
        const messages = historyMessages(history);
        const serverThreadId = typeof history?.thread_id === "string" ? history.thread_id : undefined;
        setThread((t) => ({ ...t, serverThreadId, messages }));
      })
      .catch(() => { if (live) setError("Earlier tutor messages could not be loaded."); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; controller.current?.abort(); };
  }, [lessonId]);

  const send = useCallback(async (text: string) => {
    const question = text.trim();
    if (!question || controller.current) return;
    const user: ChatMessage = { id: nanoid(), role: "user", text: question, files: [] };
    const assistantId = nanoid();
    const messages = [...threadRef.current.messages, user];
    setError("");
    setThread((t) => ({
      ...t,
      messages: [...messages, { id: assistantId, role: "assistant", text: "", reasoning: "", steps: [], status: "streaming" }],
    }));
    const current = new AbortController();
    controller.current = current;
    setStreaming(true);
    let status: "complete" | "stopped" | "error" = "complete";
    try {
      for await (const event of chatAdapter.stream({
        threadId: threadRef.current.id,
        serverThreadId: threadRef.current.serverThreadId,
        documentIds: [documentId],
        messages,
        files: [],
        settings: SETTINGS,
        lessonId,
      }, current.signal)) {
        setThread((t) => applyChatEvent(t, assistantId, event));
      }
    } catch (e) {
      status = current.signal.aborted ? "stopped" : "error";
      if (!current.signal.aborted) {
        const detail = e instanceof Error ? e.message : "The tutor could not answer. Try again.";
        setThread((t) => updateAssistantMessage(t, assistantId, (m) => ({ ...m, error: detail })));
      }
    } finally {
      setThread((t) => updateAssistantMessage(t, assistantId, (m) => finishAssistantMessage(m, status, 0)));
      controller.current = null;
      setStreaming(false);
    }
  }, [documentId, lessonId]);

  const stop = useCallback(() => controller.current?.abort(), []);

  return { messages: thread.messages, loading, error, streaming, send, stop };
}
