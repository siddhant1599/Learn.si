"use client";

import { Check, ExternalLink, FileSearch, FileText, Folder, Globe, Sparkles } from "lucide-react";

import { citationAnchor } from "@/components/chat/citation-list";
import { safeWebUrl } from "@/core/chat/privacy";

import type { AssistantMessage, DocumentCitation, WebCitation } from "@/core/chat/types";
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

type ItemState = "idle" | "highlight" | "dragging" | "active" | "done" | "earlier" | "dim";

const STATE_CLASS: Record<ItemState, string> = {
  idle: "text-foreground/80",
  highlight: "text-purple-700 dark:text-purple-400",
  dragging: "translate-x-2 text-blue-700 dark:text-blue-400",
  active: "text-foreground",
  done: "text-green-700 dark:text-green-500",
  /** Cited by an earlier answer in this chat. */
  earlier: "text-green-800/75 dark:text-green-500/55",
  dim: "text-zinc-500 dark:text-zinc-500",
};

function documentState(phase: TurnPhase, citedNow: boolean, citedBefore: boolean): ItemState {
  if (phase === "routing" || phase === "searching") return "highlight";
  if (phase === "checking") return "dragging";
  if (phase === "answering") return citedNow ? "done" : "active";
  if (citedNow) return "done";
  if (citedBefore) return "earlier";
  if (phase === "done") return "dim";
  return "idle";
}

type DocEntry = { key: string; citation: DocumentCitation; messageId: string; latest: boolean };
type WebEntry = { key: string; citation: WebCitation; latest: boolean };

/**
 * Every source the chat has cited, oldest first, without repeats. A section cited again
 * points at its most recent answer; `latest` marks sources the newest answer cites.
 */
export function chatCitations(messages: AssistantMessage[]) {
  const docs = new Map<string, DocEntry>();
  const web = new Map<string, WebEntry>();
  const last = messages.at(-1);
  for (const message of messages) {
    const latest = message === last;
    for (const c of message.citations ?? []) {
      if (c.source_type === "web") {
        const key = c.url;
        web.delete(key);
        web.set(key, { key, citation: c, latest });
      } else {
        const key = [c.document_id, c.kind, c.number, c.page ?? ""].join("|");
        docs.delete(key);
        docs.set(key, { key, citation: c, messageId: message.id, latest });
      }
    }
  }
  return { docs: [...docs.values()], web: [...web.values()] };
}

/** Fired before a reveal so the chat releases its stick-to-bottom lock (see MessageList). */
export const REVEAL_CITATION_EVENT = "learn-si:reveal-citation";

/** Scroll the chat to a citation under the answer that made it, open it and flash it. */
export function revealCitation(anchorId: string) {
  const target = document.getElementById(anchorId);
  if (!target) return;
  window.dispatchEvent(new CustomEvent(REVEAL_CITATION_EVENT, { detail: anchorId }));
  target.querySelector("details")?.setAttribute("open", "");
  target.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
  target.setAttribute("data-flash", "");
  window.setTimeout(() => target.removeAttribute("data-flash"), 1600);
}

/**
 * The landing demo's left panel for a real chat: the chat's documents under /documents/,
 * each with every section the chat has cited so far. Sections the newest answer cites
 * light up as it is written; earlier ones stay listed. Items change colour as the answer
 * moves through routing, search, evidence checks and writing. Clicking a section shows it
 * in the chat; clicking a web source opens it.
 */
export function SourceTree({
  documents,
  messages,
  deletedIds,
  className,
}: {
  documents: { id: string; title: string; edition?: string }[];
  messages: AssistantMessage[];
  deletedIds: string[];
  className?: string;
}) {
  const message = messages.at(-1);
  const phase = phaseOf(message);
  const text = message?.text ?? "";
  const marked = (n: number) => text.includes(`[${n}]`);
  const { docs, web } = chatCitations(messages);
  const usedWeb = messages.some((m) => m.steps.some((s) => s.id.split(":")[0] === "web"));

  return (
    <aside aria-label="Sources in this chat" data-source-tree data-phase={phase} className={cn("flex min-w-0 flex-col", className)}>
      <div className="mb-4 font-mono text-sm text-zinc-600 dark:text-muted-foreground">/documents/</div>
      {documents.length === 0 && <p className="text-sm text-zinc-600 dark:text-muted-foreground">No sources selected.</p>}
      <ul className="space-y-3">
        {documents.map((doc) => {
          const own = docs.filter((entry) => entry.citation.document_id === doc.id);
          const citedNow = own.some((e) => e.latest && (marked(e.citation.citation) || phase === "done"));
          const state = documentState(phase, citedNow, own.length > 0);
          const deleted = deletedIds.includes(doc.id);
          return (
            <li key={doc.id} data-tree-document={state}>
              <div className={cn("flex min-w-0 items-center gap-3 text-base font-medium transition-all duration-300 motion-reduce:transition-none", STATE_CLASS[deleted ? "dim" : state])}>
                <FileText aria-hidden="true" className="size-5 shrink-0" />
                <span className="min-w-0 truncate" title={doc.title}>
                  {doc.title}
                  {deleted && " (deleted)"}
                </span>
                {(state === "done" || state === "earlier") && !deleted && <Check aria-label="Cited" className="size-4 shrink-0" />}
                {state === "highlight" && <Sparkles aria-hidden="true" className="size-4 shrink-0 text-purple-600 dark:text-purple-400" />}
              </div>
              {own.length > 0 && (
                <ul className="mt-1.5 space-y-1 pl-8">
                  {own.map(({ key, citation: c, messageId, latest }) => {
                    const section = `${c.kind} ${c.number}${c.page ? ` · Page ${c.page}` : ""}`;
                    const sectionState: ItemState = latest
                      ? marked(c.citation) || phase === "done" ? "done" : "dim"
                      : "earlier";
                    return (
                      <li key={key} data-tree-section={sectionState === "earlier" ? "earlier" : sectionState === "done" ? "done" : "pending"}>
                        <button
                          type="button"
                          onClick={() => revealCitation(citationAnchor(messageId, c.citation))}
                          aria-label={`Show [${c.citation}] ${section} in the chat`}
                          title={latest ? "Show in the latest answer" : "Cited in an earlier answer: show it"}
                          className={cn(
                            "flex w-full min-w-0 items-center gap-2 rounded-md px-1.5 py-0.5 text-left text-sm transition-colors duration-300 hover:bg-black/5 focus-visible:ring-2 focus-visible:ring-blue-500/60 focus-visible:outline-none dark:hover:bg-white/5",
                            "animate-in fade-in slide-in-from-left-2 duration-300 motion-reduce:animate-none",
                            STATE_CLASS[sectionState],
                          )}
                        >
                          <FileSearch aria-hidden="true" className="size-4 shrink-0" />
                          <span className="min-w-0 truncate">
                            [{c.citation}] {section}
                          </span>
                          {sectionState !== "dim" && <Check aria-hidden="true" className="size-3.5 shrink-0" />}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
        {(usedWeb || web.length > 0) && (
          <li data-tree-web>
            <div className={cn("flex items-center gap-3 text-base font-medium", web.length ? STATE_CLASS.done : STATE_CLASS.dim)}>
              <Folder aria-hidden="true" className="size-5 shrink-0" />
              <span>Web</span>
            </div>
            <ul className="mt-1.5 space-y-1 pl-8">
              {web.map(({ key, citation: c, latest }) => (
                <li key={key}>
                  {safeWebUrl(c.url) ? (
                    <a
                      href={c.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={c.url}
                      className={cn(
                        "flex min-w-0 items-center gap-2 rounded-md px-1.5 py-0.5 text-sm hover:bg-black/5 hover:underline focus-visible:ring-2 focus-visible:ring-blue-500/60 focus-visible:outline-none dark:hover:bg-white/5",
                        STATE_CLASS[latest ? "done" : "earlier"],
                      )}
                    >
                      <Globe aria-hidden="true" className="size-4 shrink-0" />
                      <span className="min-w-0 truncate">[{c.citation}] {c.title}</span>
                      <ExternalLink aria-hidden="true" className="size-3 shrink-0 opacity-70" />
                    </a>
                  ) : (
                    <span className={cn("flex min-w-0 items-center gap-2 px-1.5 text-sm", STATE_CLASS.dim)}>
                      <Globe aria-hidden="true" className="size-4 shrink-0" />
                      <span className="min-w-0 truncate">[{c.citation}] {c.title} · unavailable link</span>
                    </span>
                  )}
                </li>
              ))}
              {!web.length && <li className="px-1.5 text-sm text-zinc-600 dark:text-muted-foreground">No web sources used</li>}
            </ul>
          </li>
        )}
      </ul>
    </aside>
  );
}
