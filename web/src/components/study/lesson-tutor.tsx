"use client";

import { ArrowUpIcon, Loader2, MessageCircleQuestionIcon, SquareIcon } from "lucide-react";
import { useId, useState } from "react";

import { MessageList } from "@/components/chat/message-list";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useTutor } from "@/core/study/use-tutor";

export const TUTOR_WELCOME =
  "Ask about this lesson — I'll guide you first; ask for the answer whenever you want it.";
export const TUTOR_CHIPS = ["Explain this differently", "Why is this true?", "Just tell me the answer"];

/** Lesson-scoped tutor: document-only answers, guidance first, history kept on the server. */
export function LessonTutor({ lessonId, documentId }: { lessonId: string; documentId: string }) {
  const { messages, loading, error, streaming, send, stop } = useTutor(lessonId, documentId);
  const [draft, setDraft] = useState("");
  const inputId = useId();
  const submit = (text = draft) => {
    if (!text.trim() || streaming) return;
    void send(text);
    setDraft("");
  };
  return (
    <aside aria-labelledby="tutor-heading" className="flex h-[32rem] min-w-0 flex-col rounded-xl border xl:sticky xl:top-4 xl:h-[calc(100vh-10rem)]">
      <h2 id="tutor-heading" className="flex items-center gap-2 border-b px-4 py-3 text-sm font-medium">
        <MessageCircleQuestionIcon aria-hidden="true" className="size-4 text-muted-foreground" />
        Tutor
      </h2>
      <div className="min-h-0 flex-1">
        {loading ? (
          <p role="status" className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
            <Loader2 aria-hidden="true" className="size-4 animate-spin" /> Loading the conversation…
          </p>
        ) : messages.length === 0 ? (
          <div className="space-y-3 p-4">
            <p className="text-sm text-muted-foreground">{TUTOR_WELCOME}</p>
          </div>
        ) : (
          <MessageList className="size-full text-sm" messages={messages} />
        )}
      </div>
      {error && <p role="alert" className="px-4 pb-2 text-xs text-destructive">{error}</p>}
      <div className="space-y-2 border-t p-3">
        <div className="flex flex-wrap gap-1.5">
          {TUTOR_CHIPS.map((chip) => (
            <Button key={chip} type="button" size="sm" variant="outline" className="h-7 rounded-full px-3 text-xs"
              disabled={streaming} onClick={() => submit(chip)}>
              {chip}
            </Button>
          ))}
        </div>
        <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <label htmlFor={inputId} className="sr-only">Ask the tutor</label>
          <Textarea
            id={inputId}
            value={draft}
            maxLength={4000}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
            }}
            placeholder="Ask about this lesson…"
            className="max-h-32 min-h-10 resize-none text-sm"
          />
          {streaming ? (
            <Button type="button" size="icon" variant="outline" aria-label="Stop" onClick={stop}>
              <SquareIcon className="size-4" />
            </Button>
          ) : (
            <Button type="submit" size="icon" aria-label="Send" disabled={!draft.trim()}>
              <ArrowUpIcon className="size-4" />
            </Button>
          )}
        </form>
      </div>
    </aside>
  );
}
