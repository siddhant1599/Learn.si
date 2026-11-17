"use client";

import { Check, FileSearch, FileText, Folder, Globe, Sparkles } from "lucide-react";

import type { AssistantMessage, Citation, DocumentCitation, WebCitation } from "@/core/chat/types";
import { cn } from "@/lib/utils";

export type TurnPhase = "idle" | "routing" | "searching" | "checking" | "answering" | "done" | "ended";

/** Where the latest answer is, from its live steps (the same stages the landing demo plays). */
export function phaseOf(message?: AssistantMessage): TurnPhase {
  if (!message) return "idle";
  if (message.status === "complete") return "done";
  if (message.status !== "streaming") return "ended";
  const active = (id: string) => message.steps.some((s) => s.id.split(":")[0] === id && s.status === "active");
  if (message.text || active("answer")) return "answering";
  if (active("assess") || active("web")) return "checking";
  if (["plan", "hyde", "retrieve", "refine"].some(active)) return "searching";
  const seen = (id: string) => message.steps.some((s) => s.id.split(":")[0] === id);
  if (seen("assess") || seen("web")) return "checking";
  if (seen("retrieve") || seen("plan")) return "searching";
  return "routing";
}

type ItemState = "idle" | "highlight" | "dragging" | "active" | "done" | "dim";

const STATE_CLASS: Record<ItemState, string> = {
  idle: "text-foreground/80",
  highlight: "text-purple-600 dark:text-purple-400",
  dragging: "translate-x-2 text-blue-600 dark:text-blue-400",
  active: "text-foreground",
  done: "text-green-600 dark:text-green-500",
  dim: "text-zinc-400 dark:text-zinc-600",
};

function documentState(phase: TurnPhase, cited: boolean): ItemState {
  if (phase === "routing" || phase === "searching") return "highlight";
  if (phase === "checking") return "dragging";
  if (phase === "answering") return cited ? "done" : "active";
  if (phase === "done") return cited ? "done" : "dim";
  return "idle";
}

/**
 * The landing demo's left panel for a real chat: the chat's documents under /documents/,
 * each with the sections the latest answer cites. Items change colour as the answer moves
 * through routing, search, evidence checks and writing.
 */
export function SourceTree({
  documents,
  message,
  deletedIds,
  className,
}: {
  documents: { id: string; title: string; edition?: string }[];
  message?: AssistantMessage;
  deletedIds: string[];
  className?: string;
}) {
  const phase = phaseOf(message);
  const citations: Citation[] = message?.citations ?? [];
  const text = message?.text ?? "";
  const marked = (n: number) => text.includes(`[${n}]`);
  const docCitations = citations.filter((c): c is DocumentCitation => c.source_type !== "web");
  const webCitations = citations.filter((c): c is WebCitation => c.source_type === "web");
  const usedWeb = message?.steps.some((s) => s.id.split(":")[0] === "web");

  return (
    <aside aria-label="Sources in this chat" data-source-tree data-phase={phase} className={cn("flex min-w-0 flex-col", className)}>
      <div className="mb-4 font-mono text-sm text-muted-foreground">/documents/</div>
      {documents.length === 0 && <p className="text-sm text-muted-foreground">No sources selected.</p>}
      <ul className="space-y-3">
        {documents.map((doc) => {
          const own = docCitations.filter((c) => c.document_id === doc.id);
          const cited = own.some((c) => marked(c.citation)) || (phase === "done" && own.length > 0);
          const state = documentState(phase, cited);
          const deleted = deletedIds.includes(doc.id);
          return (
            <li key={doc.id} data-tree-document={state}>
              <div className={cn("flex min-w-0 items-center gap-3 text-base font-medium transition-all duration-300 motion-reduce:transition-none", STATE_CLASS[deleted ? "dim" : state])}>
                <FileText aria-hidden="true" className="size-5 shrink-0" />
                <span className="min-w-0 truncate" title={doc.title}>
                  {doc.title}
                  {deleted && " (deleted)"}
                </span>
                {state === "done" && !deleted && <Check aria-label="Cited" className="size-4 shrink-0" />}
                {state === "highlight" && <Sparkles aria-hidden="true" className="size-4 shrink-0 text-purple-600 dark:text-purple-400" />}
              </div>
              {own.length > 0 && (
                <ul className="mt-1.5 space-y-1.5 pl-8">
                  {own.map((c) => {
                    const on = marked(c.citation) || phase === "done";
                    return (
                      <li
                        key={c.citation}
                        data-tree-section={on ? "done" : "pending"}
                        className={cn("flex min-w-0 items-center gap-2 text-sm transition-colors duration-300 animate-in fade-in slide-in-from-left-2 duration-300 motion-reduce:animate-none", on ? STATE_CLASS.done : STATE_CLASS.dim)}
                      >
                        <FileSearch aria-hidden="true" className="size-4 shrink-0" />
                        <span className="min-w-0 truncate">
                          [{c.citation}] {c.kind} {c.number}
                          {c.page ? ` · Page ${c.page}` : ""}
                        </span>
                        {on && <Check aria-hidden="true" className="size-3.5 shrink-0" />}
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
        {(usedWeb || webCitations.length > 0) && (
          <li data-tree-web>
            <div className={cn("flex items-center gap-3 text-base font-medium", webCitations.length ? STATE_CLASS.done : STATE_CLASS.dim)}>
              <Folder aria-hidden="true" className="size-5 shrink-0" />
              <span>Web</span>
            </div>
            <ul className="mt-1.5 space-y-1.5 pl-8">
              {webCitations.map((c) => (
                <li key={c.citation} className={cn("flex min-w-0 items-center gap-2 text-sm", STATE_CLASS.done)}>
                  <Globe aria-hidden="true" className="size-4 shrink-0" />
                  <span className="min-w-0 truncate">[{c.citation}] {c.title}</span>
                </li>
              ))}
              {!webCitations.length && <li className="text-sm text-muted-foreground">No web sources used</li>}
            </ul>
          </li>
        )}
      </ul>
    </aside>
  );
}
