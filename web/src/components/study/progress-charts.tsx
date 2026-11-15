"use client";

import { useState } from "react";

import type { Mastery, QuizPerformance } from "@/core/study/types";
import { cn } from "@/lib/utils";

import { MASTERY } from "./course-plan";

export const MASTERY_ORDER: Mastery[] = ["not_started", "learning", "developing", "proficient", "mastered"];
const MASTERY_FILL: Record<Mastery, string> = {
  not_started: "var(--viz-mastery-not-started)",
  learning: "var(--viz-mastery-learning)",
  developing: "var(--viz-mastery-developing)",
  proficient: "var(--viz-mastery-proficient)",
  mastered: "var(--viz-mastery-mastered)",
};

function Tooltip({ children }: { children: React.ReactNode }) {
  return (
    <span role="tooltip" className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1.5 -translate-x-1/2 rounded-md border bg-popover px-2 py-1 text-xs whitespace-nowrap text-popover-foreground shadow-sm">
      {children}
    </span>
  );
}

export function masterySummary(distribution: Record<Mastery, number>): string {
  const total = MASTERY_ORDER.reduce((sum, level) => sum + (distribution[level] ?? 0), 0);
  if (!total) return "No lessons yet.";
  const parts = MASTERY_ORDER.filter((level) => distribution[level])
    .map((level) => `${distribution[level]} ${MASTERY[level].label.toLowerCase()}`);
  return `${total} ${total === 1 ? "lesson" : "lessons"}: ${parts.join(", ")}.`;
}

/**
 * Mastery distribution as a segmented bar (ordinal blue ramp, neutral for not
 * started) with a text legend carrying the counts, so identity is never color-alone.
 */
export function MasteryBar({ distribution, compact = false }: { distribution: Record<Mastery, number>; compact?: boolean }) {
  const [hover, setHover] = useState<Mastery | null>(null);
  const total = MASTERY_ORDER.reduce((sum, level) => sum + (distribution[level] ?? 0), 0);
  const summary = masterySummary(distribution);
  return (
    <figure className="viz-root min-w-0 space-y-2">
      <div role="img" aria-label={`Mastery distribution. ${summary}`} className="flex h-2.5 w-full gap-[2px]">
        {total === 0 ? (
          <span className="h-full w-full rounded-full" style={{ background: "var(--viz-track)" }} />
        ) : MASTERY_ORDER.filter((level) => distribution[level]).map((level) => (
          <span
            key={level}
            data-level={level}
            className="relative h-full first:rounded-l-[4px] last:rounded-r-[4px]"
            style={{ flexGrow: distribution[level], flexBasis: 0, background: MASTERY_FILL[level] }}
            onMouseEnter={() => setHover(level)}
            onMouseLeave={() => setHover(null)}
          >
            {/* Hit target taller than the mark. */}
            <span aria-hidden="true" className="absolute -inset-y-2 inset-x-0" />
            {hover === level && (
              <Tooltip>{MASTERY[level].label}: {distribution[level]} of {total}</Tooltip>
            )}
          </span>
        ))}
      </div>
      <figcaption className={cn("flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground", compact && "gap-x-2")}>
        {MASTERY_ORDER.map((level) => {
          const meta = MASTERY[level];
          return (
            <span key={level} className="inline-flex items-center gap-1" data-legend={level}>
              <span aria-hidden="true" className="size-2.5 rounded-[2px]" style={{ background: MASTERY_FILL[level] }} />
              <meta.icon aria-hidden="true" className="size-3" />
              {meta.label} <span className="tabular-nums text-foreground">{distribution[level] ?? 0}</span>
            </span>
          );
        })}
      </figcaption>
    </figure>
  );
}

const BLOOM_LABEL = { recall: "Recall", apply: "Apply", analyze: "Analyze" } as const;

/** Share of quiz answers correct per Bloom level: one series, values labeled directly. */
export function BloomBars({ bloom }: { bloom: QuizPerformance["bloom"] }) {
  const [hover, setHover] = useState<string | null>(null);
  const levels = (Object.keys(BLOOM_LABEL) as (keyof typeof BLOOM_LABEL)[]);
  const answered = levels.some((level) => bloom?.[level]?.questions);
  if (!answered) return <p className="text-sm text-muted-foreground">No quiz answers yet.</p>;
  const rows = levels.map((level) => {
    const { questions = 0, correct = 0 } = bloom[level] ?? {};
    return { level, questions, correct, share: questions ? correct / questions : 0 };
  });
  const summary = rows.filter((r) => r.questions)
    .map((r) => `${BLOOM_LABEL[r.level]} ${r.correct} of ${r.questions} correct`).join(", ");
  return (
    <figure className="viz-root space-y-2">
      <figcaption className="sr-only">Correct answers by question type: {summary}.</figcaption>
      <div className="space-y-2" aria-hidden="true">
        {rows.map((row) => (
          <div key={row.level} className="grid grid-cols-[4.5rem_minmax(0,1fr)_6.5rem] items-center gap-2 text-xs" data-bloom={row.level}>
            <span className="text-muted-foreground">{BLOOM_LABEL[row.level]}</span>
            <span className="relative h-2.5 rounded-[4px]" style={{ background: "var(--viz-track)" }}
              onMouseEnter={() => setHover(row.level)} onMouseLeave={() => setHover(null)}>
              {row.questions > 0 && (
                <span className="absolute inset-y-0 left-0 rounded-[4px]"
                  style={{ width: `${Math.max(row.share * 100, row.correct ? 2 : 0)}%`, background: "var(--viz-series-1)" }} />
              )}
              <span className="absolute -inset-y-2 inset-x-0" />
              {hover === row.level && (
                <Tooltip>{BLOOM_LABEL[row.level]}: {row.correct} of {row.questions} correct</Tooltip>
              )}
            </span>
            <span className="text-right tabular-nums">
              {row.questions ? `${row.correct}/${row.questions} · ${Math.round(row.share * 100)}%` : "—"}
            </span>
          </div>
        ))}
      </div>
      <table className="sr-only">
        <caption>Correct answers by question type</caption>
        <thead><tr><th scope="col">Type</th><th scope="col">Correct</th><th scope="col">Answered</th></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.level}><th scope="row">{BLOOM_LABEL[row.level]}</th><td>{row.correct}</td><td>{row.questions}</td></tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
