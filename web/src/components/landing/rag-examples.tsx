"use client";

import { ArrowRight, BookOpen, FileText, Pause, Play, RotateCcw } from "lucide-react";
import Link from "next/link";
import { Fragment, useEffect, useRef, useState } from "react";

import { MessageSteps } from "@/components/chat/message-steps";
import {
  DEMO_SOURCE,
  answerCharsAt,
  demoRuns,
  runDurationMs,
  stepsAt,
} from "@/content/landing-demo";
import {
  usePrefersReducedMotion,
  useRenderActivity,
} from "@/core/dom/render-activity";
import { cn } from "@/lib/utils";

import { Section } from "./section";

const TICK_MS = 50;

/**
 * Scripted Ask runs over the synthetic handbook, rendered through the product's
 * real activity panel and citation style. No model calls; timings are illustrative.
 */
export function RagExamples() {
  const [selected, setSelected] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [paused, setPaused] = useState(false);
  const [focusCitation, setFocusCitation] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const active = useRenderActivity(ref, false);
  const reduced = usePrefersReducedMotion();
  const run = demoRuns[selected]!;
  const duration = runDurationMs(run);
  const done = reduced || elapsed >= duration;
  const shownElapsed = reduced ? duration : elapsed;

  useEffect(() => {
    setElapsed(0);
    setFocusCitation(null);
  }, [selected]);

  useEffect(() => {
    if (!active || paused || done) return;
    const timer = setInterval(() => setElapsed((value) => Math.min(duration, value + TICK_MS)), TICK_MS);
    return () => clearInterval(timer);
  }, [active, paused, done, duration]);

  const steps = stepsAt(run, shownElapsed);
  const chars = answerCharsAt(run, shownElapsed);
  const streamed = run.answer.slice(0, chars);
  const citedNumbers = new Set(
    [...streamed.matchAll(/\[(\d)\]/g)].map((match) => Number(match[1])),
  );

  return (
    <Section
      id="examples"
      title="Watch a question become an answer"
      subtitle="Three scripted runs over a synthetic handbook, shown through the same activity panel and citations you get in the workspace."
    >
      <div ref={ref} className="mx-auto mt-10 max-w-6xl">
        <div className="mb-6 flex flex-wrap justify-center gap-3" role="tablist" aria-label="Example questions">
          {demoRuns.map((item, index) => (
            <button
              key={item.label}
              role="tab"
              tabIndex={selected === index ? 0 : -1}
              onKeyDown={(event) => {
                if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                event.preventDefault();
                const next =
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? demoRuns.length - 1
                      : (selected + (event.key === "ArrowRight" ? 1 : -1) + demoRuns.length) % demoRuns.length;
                setSelected(next);
                document.getElementById(`example-tab-${next}`)?.focus();
              }}
              aria-selected={selected === index}
              aria-controls="example-panel"
              id={`example-tab-${index}`}
              onClick={() => setSelected(index)}
              className={cn(
                "rounded-full border px-5 py-3 text-sm transition-colors",
                selected === index
                  ? "border-amber-200/40 bg-amber-200/10 text-amber-100"
                  : "text-muted-foreground hover:bg-white/5",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div
          id="example-panel"
          role="tabpanel"
          aria-labelledby={`example-tab-${selected}`}
          className="overflow-hidden rounded-2xl border border-white/15 bg-white/[0.025] shadow-2xl"
        >
          <div className="flex items-center justify-between gap-3 border-b border-white/10 px-6 py-4 text-sm">
            <span className="flex min-w-0 items-center gap-2">
              <span className="size-2 shrink-0 rounded-full bg-amber-200" /> Study Buddy{" "}
              <span className="text-muted-foreground truncate">/ Ask · scripted run</span>
            </span>
            <span className="flex items-center gap-2">
              <button
                aria-label="Replay preview"
                onClick={() => {
                  setElapsed(0);
                  setPaused(false);
                }}
                className="rounded-md border p-2 hover:bg-white/5"
              >
                <RotateCcw size={14} />
              </button>
              <button
                aria-label={paused ? "Play preview" : "Pause preview"}
                aria-pressed={paused}
                onClick={() => setPaused((value) => !value)}
                className="rounded-md border p-2 hover:bg-white/5"
              >
                {paused ? <Play size={14} /> : <Pause size={14} />}
              </button>
            </span>
          </div>
          <div className="grid min-h-[460px] md:grid-cols-[0.9fr_1.1fr]">
            <div className="border-b border-white/10 p-6 sm:p-9 md:border-r md:border-b-0">
              <div className="text-muted-foreground mb-6 flex items-center gap-3 text-sm">
                <FileText size={18} />
                {DEMO_SOURCE}
                <span className="ml-auto text-xs">Page 12</span>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/20 p-6">
                <div className="text-muted-foreground mb-4 text-xs tracking-widest uppercase">
                  Selected source · synthetic
                </div>
                <p className="font-serif text-lg leading-relaxed text-white/85 sm:text-xl">
                  {run.passages.map((passage) => {
                    const cited = passage.cite !== undefined && citedNumbers.has(passage.cite);
                    const focused = cited && focusCitation === passage.cite;
                    return (
                      <Fragment key={passage.text}>
                        <span
                          data-cited={cited ? (focused ? "focus" : "true") : undefined}
                          className={cn(
                            "rounded-sm transition-colors duration-500 motion-reduce:transition-none",
                            cited && "bg-amber-200/15 text-white",
                            focused && "bg-amber-200/35",
                          )}
                        >
                          {passage.text}
                        </span>{" "}
                      </Fragment>
                    );
                  })}
                </p>
              </div>
              <p className="text-muted-foreground mt-5 text-xs">
                Highlighted sentences are the ones the answer cites. Hover a citation to find its sentence.
              </p>
            </div>
            <div className="p-6 sm:p-9">
              <div className="ml-4 rounded-2xl bg-white/10 px-5 py-4 text-sm">{run.question}</div>
              <div className="mt-6">
                <MessageSteps steps={steps} />
              </div>
              <div className="mt-6 min-h-24" aria-live="polite" aria-atomic="false" data-demo-answer>
                {chars > 0 ? (
                  <>
                    <p className="text-base leading-8">
                      <AnswerText text={streamed} onFocusCitation={setFocusCitation} />
                      {!done && <span className="ml-0.5 inline-block h-5 w-0.5 animate-pulse bg-amber-200 align-middle motion-reduce:animate-none" aria-hidden="true" />}
                    </p>
                    <ul className="mt-5 space-y-2">
                      {run.citations
                        .filter((citation) => citedNumbers.has(citation.n))
                        .map((citation) => (
                          <li
                            key={citation.n}
                            onMouseEnter={() => setFocusCitation(citation.n)}
                            onMouseLeave={() => setFocusCitation(null)}
                            className="flex items-start gap-2 rounded-lg border border-amber-200/20 bg-amber-200/5 p-3 text-xs text-amber-100"
                          >
                            <BookOpen size={15} className="mt-0.5 shrink-0" />
                            <span>
                              [{citation.n}] {DEMO_SOURCE} · Page 12 · {citation.module} ·{" "}
                              <span className="text-amber-100/70">“{citation.passage}”</span>
                            </span>
                          </li>
                        ))}
                    </ul>
                  </>
                ) : (
                  <div className="space-y-3" aria-label="Preview processing">
                    <div className="h-2 w-5/6 rounded bg-white/10" />
                    <div className="h-2 w-4/6 rounded bg-white/10" />
                    <div className="h-2 w-3/6 rounded bg-white/10" />
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-3 border-t border-white/10 px-6 py-4 text-xs">
            <span>Scripted illustration · synthetic handbook · no model calls · timings are illustrative</span>
            <Link href="/workspace" className="flex items-center gap-2 text-white">
              Try your documents <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      </div>
    </Section>
  );
}

function AnswerText({
  text,
  onFocusCitation,
}: {
  text: string;
  onFocusCitation: (n: number | null) => void;
}) {
  return (
    <>
      {/* The marker swallows the space before it so "Pods [1]," does not double-space. */}
      {text.split(/\s?(\[\d\])/).map((part, index) => {
        const match = part.match(/^\[(\d)\]$/);
        if (!match) return <Fragment key={index}>{part}</Fragment>;
        const n = Number(match[1]);
        return (
          <button
            key={index}
            type="button"
            data-citation={n}
            aria-label={`Citation ${n}`}
            onMouseEnter={() => onFocusCitation(n)}
            onMouseLeave={() => onFocusCitation(null)}
            onFocus={() => onFocusCitation(n)}
            onBlur={() => onFocusCitation(null)}
            className="ml-1 rounded px-0.5 text-amber-200 hover:bg-amber-200/15 focus-visible:ring-2 focus-visible:ring-amber-200/60 focus-visible:outline-none"
          >
            {part}
          </button>
        );
      })}
    </>
  );
}
