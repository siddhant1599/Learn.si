"use client";

import { Check, CircleAlert, Globe, LoaderCircle, Search, Square } from "lucide-react";

import type { ChatStep } from "@/core/chat/types";
import { cn } from "@/lib/utils";

/** Section emoji per pipeline stage, as in the landing demo (✨ routing, 🔬 research, 🔎 evidence…). */
const STAGE_EMOJI: Record<string, string> = {
  triage: "✨",
  conversational: "💬",
  plan: "🧭",
  hyde: "🧭",
  retrieve: "🔬",
  refine: "🔬",
  assess: "🔎",
  web: "🌐",
  answer: "✍️",
  error_handler: "🛟",
  // Master mode: course planning and lesson writing.
  outline: "📖",
  topics: "🧩",
  structure: "🗂️",
  estimate: "⏱️",
  evidence: "📄",
  write: "✍️",
  validate: "✅",
};

const stageOf = (step: ChatStep) => step.id.split(":")[0]!;

function statusText(step: ChatStep) {
  if (step.status === "failed") return `${step.label} — failed`;
  if (step.status === "stopped") return `${step.label} — stopped`;
  if (step.status === "active") return `${step.label} — running`;
  return step.label;
}

function StatusIcon({ step, className }: { step: ChatStep; className?: string }) {
  if (step.status === "active")
    return <LoaderCircle aria-hidden="true" className={cn("animate-spin text-blue-500 motion-reduce:animate-none dark:text-blue-400", className)} />;
  if (step.status === "failed") return <CircleAlert aria-hidden="true" className={cn("text-destructive", className)} />;
  if (step.status === "stopped") return <Square aria-hidden="true" className={cn("text-muted-foreground", className)} />;
  return <Check aria-hidden="true" className={cn("text-green-600 dark:text-green-500", className)} />;
}

/** One line under a section: a result or a sub-task, with the demo's search / web icons. */
function Line({ children, web, done }: { children: React.ReactNode; web?: boolean; done?: boolean }) {
  return (
    <div
      className={cn("flex min-w-0 items-center gap-2 text-sm animate-in fade-in slide-in-from-bottom-2 duration-300 motion-reduce:animate-none", done ? "text-muted-foreground" : "text-muted-foreground/80")}
    >
      {web ? (
        <Globe aria-hidden="true" className="size-3.5 shrink-0 text-green-600 dark:text-green-400" />
      ) : (
        <Search aria-hidden="true" className="size-3.5 shrink-0 text-blue-500 dark:text-blue-400" />
      )}
      <span className="min-w-0 break-words">{children}</span>
      {done && <Check aria-hidden="true" className="size-3.5 shrink-0 text-green-600 dark:text-green-500" />}
    </div>
  );
}

function SubTask({ step }: { step: ChatStep }) {
  return (
    <div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
      <StatusIcon step={step} className="size-3.5 shrink-0" />
      <span className="min-w-0 break-words">{statusText(step)}</span>
      {step.results?.map((result) => (
        <span key={result} className="rounded-full bg-black/5 px-2 py-0.5 text-xs dark:bg-white/5">
          {result}
        </span>
      ))}
    </div>
  );
}

/**
 * Live progress of an Ask answer or a Master generation, styled like the landing demo:
 * one emoji section per stage, results as search / web lines, sub-tasks in a details list.
 */
export function MessageSteps({ steps, detailsLabel }: { steps: ChatStep[]; detailsLabel?: string }) {
  const parents = steps.filter((step) => !step.parent);
  const running = parents.filter((step) => step.status === "active").map((step) => step.label).join(". ");
  return (
    <div className="w-full min-w-0 space-y-3" data-message-steps>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {running || "No activity running"}
      </p>
      {parents.map((step, index) => {
        const children = steps.filter((child) => child.parent === step.id).sort((a, b) => a.id.localeCompare(b.id));
        const web = step.kind === "fetch";
        return (
          <div
            key={step.id}
            className="animate-in fade-in slide-in-from-bottom-2 duration-300 motion-reduce:animate-none"
            data-step={step.id}
            data-status={step.status}
          >
            {index > 0 && <hr className="mb-3 border-zinc-200 dark:border-zinc-700" />}
            <div className="flex min-w-0 items-center gap-2 text-zinc-700 dark:text-zinc-300">
              <span aria-hidden="true">{STAGE_EMOJI[stageOf(step)] ?? "•"}</span>
              <span className={cn("min-w-0 break-words", step.status === "failed" && "text-destructive")}>{statusText(step)}</span>
              <StatusIcon step={step} className="size-4 shrink-0" />
            </div>
            {(step.results?.length || children.length) ? (
              <div className="mt-2 space-y-2 pl-6">
                {step.results?.map((result) => (
                  <Line key={result} web={web} done={step.status === "complete"}>
                    {result}
                  </Line>
                ))}
                {children.length > 0 && (
                  <details className="text-sm">
                    <summary className="cursor-pointer py-1 text-muted-foreground">
                      {detailsLabel ?? `${web ? "Web" : "Research"} task details`} ({children.length})
                    </summary>
                    <div className="space-y-2 pt-2 pl-2">
                      {children.map((child) => (
                        <SubTask key={child.id} step={child} />
                      ))}
                    </div>
                  </details>
                )}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
