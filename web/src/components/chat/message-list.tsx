"use client";

import { PaperclipIcon } from "lucide-react";
import { memo, useMemo } from "react";

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageToolbar,
} from "@/components/ai-elements/message";
import {
  ClipboardSafeStreamdown,
  type ClipboardSafeStreamdownProps,
} from "@/components/ai-elements/streamdown";
import {
  rehypeCitationMarkers,
  rehypeStreamingListItems,
  streamdownPluginsWithoutRawHtml,
  streamdownSmoothStreamingAnimation,
} from "@/core/streamdown/plugins";
import { preprocessStreamdownMarkdown } from "@/core/streamdown/preprocess";
import type {
  AssistantMessage,
  ChatMessage,
  UserMessage,
} from "@/core/chat/types";
import { cn } from "@/lib/utils";

import { CopyButton } from "./copy-button";
import { MessageReasoning } from "./message-reasoning";
import { CitationList } from "./citation-list";
import { MessageSteps } from "./message-steps";
import { StreamingIndicator } from "./streaming-indicator";

const TOOLBAR_VISIBILITY =
  "z-20 opacity-0 transition-opacity delay-200 duration-300 group-hover/conversation-message:opacity-100 focus-within:opacity-100";

export function Markdown({
  content,
  isLoading,
}: {
  content: string;
  isLoading: boolean;
}) {
  const rehypePlugins = useMemo(
    () =>
      [
        ...(streamdownPluginsWithoutRawHtml.rehypePlugins ?? []),
        ...(isLoading ? [rehypeStreamingListItems] : []),
        rehypeCitationMarkers,
      ] as ClipboardSafeStreamdownProps["rehypePlugins"],
    [isLoading],
  );
  const normalized = useMemo(
    () => preprocessStreamdownMarkdown(content),
    [content],
  );
  return (
    <ClipboardSafeStreamdown
      {...streamdownPluginsWithoutRawHtml}
      className="my-3 [&_[data-citation-marker]]:ml-0.5 [&_[data-citation-marker]]:rounded [&_[data-citation-marker]]:bg-blue-500/15 [&_[data-citation-marker]]:px-1 [&_[data-citation-marker]]:text-sm [&_[data-citation-marker]]:text-blue-700 dark:[&_[data-citation-marker]]:text-blue-300"
      rehypePlugins={rehypePlugins}
      parseIncompleteMarkdown={isLoading}
      animated={streamdownSmoothStreamingAnimation}
      isAnimating={isLoading}
    >
      {normalized}
    </ClipboardSafeStreamdown>
  );
}

const UserRow = memo(function UserRow({ message }: { message: UserMessage }) {
  return (
    <Message className="group/conversation-message relative w-full" from="user">
      {message.files.length > 0 && (
        <div className="ml-auto flex flex-wrap justify-end gap-2">
          {message.files.map((file) => (
            <span
              key={file}
              className="bg-muted text-muted-foreground flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium"
            >
              <PaperclipIcon className="size-3" />
              <span className="max-w-40 truncate">{file}</span>
            </span>
          ))}
        </div>
      )}
      <div
        className="ml-auto w-fit max-w-[90%] rounded-2xl rounded-tr-sm bg-blue-600 px-5 py-3 text-base whitespace-pre-wrap text-white animate-in fade-in slide-in-from-bottom-2 duration-300 motion-reduce:animate-none"
        data-user-bubble
      >
        {message.text}
      </div>
      <MessageToolbar
        className={cn(
          "absolute right-0 -bottom-9 left-0 justify-end",
          TOOLBAR_VISIBILITY,
        )}
      >
        <div className="pointer-events-auto flex gap-1">
          <CopyButton text={message.text} />
        </div>
      </MessageToolbar>
    </Message>
  );
});

function statusNote(status: AssistantMessage["status"]) {
  if (status === "stopped") return "Stopped";
  if (status === "error") return "The response failed";
  return null;
}

/** The demo's closing card: how well the answer is grounded, from the evidence check. */
export function verdictOf(message: AssistantMessage): "grounded" | "partial" | null {
  if (message.status !== "complete" || !message.text) return null;
  const coverage = message.steps.find((step) => step.id === "assess")?.results ?? [];
  if (coverage.includes("Partial evidence") || coverage.includes("Missing evidence")) return "partial";
  const documents = message.citations?.filter((c) => c.source_type !== "web").length ?? 0;
  return documents > 0 ? "grounded" : null;
}

function VerdictCard({ message }: { message: AssistantMessage }) {
  const verdict = verdictOf(message);
  if (!verdict) return null;
  const citations = message.citations ?? [];
  const documents = citations.filter((c) => c.source_type !== "web").length;
  const web = citations.length - documents;
  const sources = [
    documents ? `${documents} document ${documents === 1 ? "citation" : "citations"}` : "",
    web ? `${web} web ${web === 1 ? "source" : "sources"}` : "",
  ].filter(Boolean).join(" and ");
  return (
    <div
      data-verdict={verdict}
      className={cn(
        "mt-4 rounded-xl border p-4 text-base font-medium animate-in fade-in zoom-in-95 duration-300 motion-reduce:animate-none",
        verdict === "grounded"
          ? "border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-500"
          : "border-amber-400/40 bg-amber-400/10 text-amber-700 dark:text-amber-300",
      )}
    >
      {verdict === "grounded"
        ? `✅ Grounded in ${sources}`
        : `⚠️ Partial evidence: the selected documents do not cover everything${sources ? ` · ${sources}` : ""}`}
    </div>
  );
}

function AssistantRow({ message }: { message: AssistantMessage }) {
  const isLoading = message.status === "streaming";
  const isEmpty =
    !message.reasoning && !message.text && message.steps.length === 0;
  const note = statusNote(message.status);

  return (
    <Message
      className="group/conversation-message relative w-full pb-8"
      from="assistant"
    >
      {message.steps.length > 0 && <MessageSteps steps={message.steps} />}
      <MessageContent className="w-full">
        {message.text && message.steps.length > 0 && !message.steps.some((s) => s.id === "answer") && (
          <hr className="mt-1 border-zinc-200 dark:border-zinc-700" />
        )}
        {message.reasoning && (
          <MessageReasoning
            isLoading={isLoading && !message.text}
            durationSeconds={message.durationSeconds}
          >
            {message.reasoning}
          </MessageReasoning>
        )}
        {isEmpty && isLoading && <StreamingIndicator className="my-4" />}
        {message.text && (
          <Markdown content={message.text} isLoading={isLoading} />
        )}
        {message.citations && message.citations.length > 0 && (
          <CitationList citations={message.citations} />
        )}
        <VerdictCard message={message} />
        {message.warnings?.map((w) => (
          <p key={w} className="text-muted-foreground mt-2 text-sm">
            {w}
          </p>
        ))}
        {note && (
          <p role="status" className="text-destructive text-sm">
            {message.error || note}
          </p>
        )}
      </MessageContent>
      {!isLoading && message.text && (
        <MessageToolbar
          className={cn("absolute right-0 bottom-0 left-0", TOOLBAR_VISIBILITY)}
        >
          <div className="pointer-events-auto flex gap-1">
            <CopyButton text={message.text} />
          </div>
        </MessageToolbar>
      )}
    </Message>
  );
}

export function MessageList({
  className,
  messages,
}: {
  className?: string;
  messages: ChatMessage[];
}) {
  return (
    <Conversation className={className}>
      <ConversationContent className="mx-auto w-full max-w-(--container-width-md) gap-8 pt-8">
        {messages.map((message) =>
          message.role === "user" ? (
            <UserRow key={message.id} message={message} />
          ) : (
            <AssistantRow key={message.id} message={message} />
          ),
        )}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  );
}
