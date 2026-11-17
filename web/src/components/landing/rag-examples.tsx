"use client";

import {
  Check,
  FileSearch,
  FileText,
  Folder,
  Globe,
  Pause,
  Play,
  Search,
  Sparkles,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Fragment, useEffect, useRef, useState } from "react";

import type { ChatStep } from "@/core/chat/types";
import { DEMO_SOURCE, answerCharsAt, demoRuns, runDurationMs, stepsAt } from "@/content/landing-demo";
import { usePrefersReducedMotion, useRenderActivity } from "@/core/dom/render-activity";
import { cn } from "@/lib/utils";

import { Section } from "./section";

const TICK_MS = 50;
/** Largest jump one tick may make, so a stalled timer resumes without skipping steps. */
const MAX_STEP_MS = 1000;
/** How long a finished run stays on screen before the next question starts. */
export const STAGE_HOLD_MS = 2500;

/**
 * The landing's Ask demo: scripted runs over the handbook (no model calls), staged
 * like frontend-sample's "Agent Skills" animation, with a document tree that lights
 * up on the left and an agent chat on the right. The questions play in sequence.
 */
export function RagExamples() {
  const [selected, setSelected] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  const visible = useRenderActivity(containerRef, false);
  const reduced = usePrefersReducedMotion();
  const run = demoRuns[selected]!;
  const duration = runDurationMs(run);
  const shown = reduced ? duration : elapsed;
  const done = shown >= duration;

  // Auto-play once, shortly after the stage first comes into view.
  useEffect(() => {
    if (!visible || started || reduced) return;
    const timer = setTimeout(() => {
      setStarted(true);
      setPlaying(true);
    }, 300);
    return () => clearTimeout(timer);
  }, [visible, started, reduced]);

  useEffect(() => {
    if (!playing || !visible || done || reduced) return;
    // Advance by wall-clock time, not by tick count: on a busy page late ticks would
    // otherwise slow the whole run down. A long stall (e.g. a background tab) is capped
    // so the run never skips a step.
    let last = Date.now();
    const timer = setInterval(() => {
      const now = Date.now();
      const delta = Math.min(now - last, MAX_STEP_MS);
      last = now;
      setElapsed((value) => Math.min(duration, value + delta));
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [playing, visible, done, duration, reduced]);

  // Play the questions in sequence: after a short hold, a finished run hands over to the
  // next one; the stage stops only after the last question has finished.
  const last = selected === demoRuns.length - 1;
  useEffect(() => {
    if (!done || !playing || reduced) return;
    if (last) {
      setPlaying(false);
      return;
    }
    if (!visible) return;
    const timer = setTimeout(() => {
      setSelected((index) => index + 1);
      setElapsed(0);
    }, STAGE_HOLD_MS);
    return () => clearTimeout(timer);
  }, [done, playing, last, visible, reduced]);

  // Nothing has happened until the first play (the timeline's first step is at 0 ms).
  const steps = started || reduced ? stepsAt(run, shown) : [];
  const chars = answerCharsAt(run, shown);
  const streamed = run.answer.slice(0, chars);
  const cited = new Set([...streamed.matchAll(/\[(\d)\]/g)].map((match) => Number(match[1])));

  useEffect(() => {
    const chat = chatRef.current;
    if (chat && shown > 0) chat.scrollTo?.({ top: chat.scrollHeight, behavior: reduced ? "auto" : "smooth" });
  }, [steps.length, chars, shown, reduced]);

  const play = (index = selected) => {
    setSelected(index);
    setElapsed(0);
    setStarted(true);
    setPlaying(true);
  };
  const toggle = () => {
    if (playing) setPlaying(false);
    else if (done) play(last ? 0 : selected + 1); // replay starts the sequence over
    else if (elapsed === 0) play();
    else setPlaying(true);
  };

  const phase = phaseOf(steps, chars, done);
  const tree = treeFor(run, phase, cited);

  return (
    <Section
      id="examples"
      className="bg-white/[0.02]"
      title="Understand what you read"
      subtitle="Ask mode answers with evidence."
    >
      <div className="mt-6">
        <div className="mb-8 flex flex-wrap justify-center gap-2" role="group" aria-label="Demo questions">
          {demoRuns.map((item, index) => (
            <button
              key={item.label}
              type="button"
              aria-pressed={selected === index}
              onClick={() => play(index)}
              className={cn(
                "rounded-full px-4 py-2 text-sm transition-all",
                selected === index
                  ? "bg-white/15 text-white"
                  : "bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-white",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div
          ref={containerRef}
          className="relative mx-auto flex w-full max-w-6xl items-center justify-center overflow-hidden px-0 pb-20 sm:px-8"
        >
          {/* Overlay play button until the first run starts. */}
          <AnimatePresence>
            {!started && !reduced && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 z-30 flex items-center justify-center bg-black/30"
              >
                <motion.button
                  type="button"
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.8, opacity: 0 }}
                  onClick={() => play()}
                  className="group flex flex-col items-center gap-4 transition-transform hover:scale-105 active:scale-95"
                >
                  <span className="flex size-24 items-center justify-center rounded-full bg-white/10 backdrop-blur-md transition-all group-hover:bg-white/20">
                    <Play size={48} className="ml-1 text-white transition-transform group-hover:scale-110" fill="white" />
                  </span>
                  <span className="text-lg font-medium text-white">Click to play</span>
                </motion.button>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="flex w-full flex-col gap-8 md:h-[560px] md:flex-row">
            {/* Left: the document, lighting up as it is searched and cited. */}
            <div className="flex flex-col md:w-[42%]">
              <div className="mb-4 font-mono text-sm text-zinc-500">/documents/</div>
              <div className={cn("mb-3 flex items-center gap-3 text-lg font-medium transition-colors duration-300", tree.fileClass)}>
                <FileText size={20} />
                <span className="truncate">{DEMO_SOURCE}</span>
                {phase === "done" && <Check size={16} className="text-green-500" />}
                {phase === "routing" && <Sparkles size={16} className="text-purple-400" />}
              </div>
              <div className="space-y-2">
                {tree.items.map((item) => (
                  <motion.div
                    key={item.key}
                    layout={!reduced}
                    data-stage-passage={item.state}
                    className={cn(
                      "flex items-start gap-3 font-medium transition-all duration-300 motion-reduce:transition-none",
                      item.folder ? "text-base" : "text-sm",
                      STATE_CLASS[item.state],
                      item.state === "dragging" && "translate-x-6 scale-[1.03]",
                    )}
                    style={{ paddingLeft: item.folder ? 24 : 48 }}
                  >
                    {item.folder ? <Folder size={18} className="mt-0.5 shrink-0" /> : <FileSearch size={16} className="mt-0.5 shrink-0" />}
                    <span>{item.text}</span>
                    {item.state === "done" && <Check size={15} className="mt-0.5 shrink-0 text-green-500" />}
                    {item.state === "highlight" && <Sparkles size={15} className="mt-0.5 shrink-0 text-purple-400" />}
                  </motion.div>
                ))}
              </div>
            </div>

            {/* Right: the agent chat. */}
            <div className="flex min-h-[460px] flex-1 flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/50 md:min-h-0">
              <div className="border-b border-zinc-800 p-4">
                <div className="flex items-center gap-2">
                  <span className={cn("size-3 rounded-full bg-green-500", playing && "animate-pulse motion-reduce:animate-none")} />
                  <span className="text-sm text-zinc-400">Study Buddy Agent · Ask mode</span>
                </div>
              </div>

              <div ref={chatRef} className="flex-1 space-y-4 overflow-y-auto p-6">
                <AnimatePresence>
                  {(shown > 0 || started || reduced) && (
                    <motion.div key={`q-${selected}`} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="flex justify-end">
                      <div className="max-w-[90%] rounded-2xl rounded-tr-sm bg-blue-600 px-5 py-3">
                        <p className="text-base text-white">{run.question}</p>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <div className="space-y-3">
                  {blocksFor(steps).map((block) => (
                    <motion.div key={`${selected}-${block.id}`} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
                      {block.divider && <hr className="mb-3 border-zinc-700" />}
                      <div className="mb-2 text-zinc-300">
                        {block.icon} {block.title}
                      </div>
                      <div className="space-y-2 pl-4">
                        {block.lines.map((line) => (
                          <motion.div
                            key={line.text}
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            className={cn("flex items-center gap-2 text-sm", line.complete ? "text-zinc-400" : "text-zinc-500")}
                          >
                            {line.kind === "web" ? (
                              <Globe size={14} className="shrink-0 text-green-400" />
                            ) : (
                              <Search size={14} className="shrink-0 text-blue-400" />
                            )}
                            <span className="truncate">{line.text}</span>
                            {line.complete && <Check size={14} className="shrink-0 text-green-500" />}
                          </motion.div>
                        ))}
                      </div>
                    </motion.div>
                  ))}
                </div>

                {chars > 0 && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} aria-live="polite" data-stage-answer>
                    <hr className="mb-3 border-zinc-700" />
                    <div className="mb-2 text-zinc-300">✍️ Answer</div>
                    <p className="text-base leading-7 text-zinc-100">
                      <StageAnswer text={streamed} />
                      {!done && <span className="ml-0.5 inline-block h-5 w-0.5 animate-pulse bg-blue-400 align-middle motion-reduce:animate-none" aria-hidden="true" />}
                    </p>
                    <div className="mt-3 space-y-2">
                      {run.citations
                        .filter((citation) => cited.has(citation.n))
                        .map((citation) => (
                          <motion.div
                            key={citation.n}
                            initial={{ opacity: 0, x: -8 }}
                            animate={{ opacity: 1, x: 0 }}
                            className="flex items-start gap-2 text-xs text-zinc-400"
                          >
                            <FileText size={14} className="mt-0.5 shrink-0" />
                            <span>
                              <span className="text-blue-300">[{citation.n}]</span> {DEMO_SOURCE} · Page 12 · {citation.module} · “{citation.passage}”
                            </span>
                          </motion.div>
                        ))}
                    </div>
                    {done && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className={cn(
                          "mt-4 rounded-xl border p-4 text-base font-medium",
                          verdictOf(steps) === "partial"
                            ? "border-amber-400/30 bg-amber-400/10 text-amber-300"
                            : "border-green-500/30 bg-green-500/10 text-green-500",
                        )}
                      >
                        {verdictOf(steps) === "partial"
                          ? "⚠️ Partly answered: the gap is named, not guessed"
                          : `✅ Grounded in ${run.citations.length} cited ${run.citations.length === 1 ? "sentence" : "sentences"}`}
                      </motion.div>
                    )}
                  </motion.div>
                )}
              </div>

              {/* Decorative input, as in the sample. */}
              <div className="border-t border-zinc-800 p-4">
                <div className="rounded-xl bg-zinc-800 px-4 py-3 text-sm text-zinc-500">Ask Study Buddy about your documents…</div>
              </div>
            </div>
          </div>

          {/* Bottom-left play / pause. */}
          {!reduced && (
            <div className="absolute bottom-2 left-0 z-20 flex items-center gap-2 sm:left-8">
              <button
                type="button"
                onClick={toggle}
                aria-label={playing ? "Pause demo" : "Play demo"}
                className="flex size-12 items-center justify-center rounded-full bg-white/10 backdrop-blur-md transition-all hover:scale-110 hover:bg-white/20 active:scale-95"
              >
                {playing ? <Pause size={24} className="text-white" fill="white" /> : <Play size={24} className="ml-0.5 text-white" fill="white" />}
              </button>
              <span className="text-lg font-medium text-white" aria-hidden="true">
                Click to {playing ? "pause" : done && last ? "replay" : "play"}
              </span>
            </div>
          )}
        </div>
      </div>
    </Section>
  );
}

type Phase = "idle" | "routing" | "searching" | "checking" | "answering" | "done";
type PassageState = "idle" | "highlight" | "dragging" | "active" | "done";

const STATE_CLASS: Record<PassageState, string> = {
  idle: "text-zinc-600",
  highlight: "text-purple-400",
  dragging: "text-blue-400",
  active: "text-white",
  done: "text-green-500",
};

function phaseOf(steps: ChatStep[], chars: number, done: boolean): Phase {
  if (done) return "done";
  if (chars > 0 || steps.some((s) => s.id === "answer")) return "answering";
  if (steps.some((s) => s.id === "assess" || s.id === "web")) return "checking";
  if (steps.some((s) => s.id === "retrieve" || s.id === "plan")) return "searching";
  return steps.length ? "routing" : "idle";
}

/** Module folders with the run's sentences; cited sentences move through the states. */
function treeFor(run: (typeof demoRuns)[number], phase: Phase, cited: Set<number>) {
  const modules = [...new Set(run.passages.map((p) => p.module))];
  const items: { key: string; text: string; folder: boolean; state: PassageState }[] = [];
  for (const module of modules) {
    const passages = run.passages.filter((p) => p.module === module);
    const states = passages.map((p) => passageState(p.cite, phase, cited));
    const folder: PassageState = states.every((s) => s === "done" || s === "idle") && states.includes("done")
      ? "done"
      : states.some((s) => s !== "idle") ? "active" : "idle";
    items.push({ key: `m-${module}`, text: module, folder: true, state: folder });
    passages.forEach((p, i) => items.push({ key: p.text, text: p.text, folder: false, state: states[i]! }));
  }
  const fileClass = phase === "done" ? "text-green-500" : phase === "idle" ? "text-zinc-500" : phase === "routing" ? "text-purple-400" : "text-white";
  return { items, fileClass };
}

function passageState(cite: number | undefined, phase: Phase, cited: Set<number>): PassageState {
  if (phase === "searching") return "highlight"; // every sentence is scanned
  if (cite === undefined) return "idle";
  if (cited.has(cite)) return "done";
  if (phase === "checking") return "dragging"; // evidence pulled into the chat
  if (phase === "answering") return "active";
  return "idle";
}

/** The product's step timeline, grouped into the sample's emoji sections. */
function blocksFor(steps: ChatStep[]) {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const blocks: { id: string; icon: string; title: string; divider: boolean; lines: { text: string; kind: "search" | "web"; complete: boolean }[] }[] = [];
  const triage = byId.get("triage");
  if (triage) {
    blocks.push({
      id: "triage",
      icon: "✨",
      title: triage.status === "complete" ? `Routed: ${triage.results?.[0] ?? ""}` : "Choosing how to handle your question…",
      divider: false,
      lines: [],
    });
  }
  const plan = byId.get("plan");
  const retrieve = byId.get("retrieve");
  if (plan || retrieve) {
    const lines: { text: string; kind: "search" | "web"; complete: boolean }[] = [];
    if (plan) lines.push({ text: plan.status === "complete" ? `Search planned · ${plan.results?.[0] ?? ""}` : "Preparing research questions", kind: "search", complete: plan.status === "complete" });
    const children = steps.filter((s) => s.parent === "retrieve");
    for (const child of children) {
      lines.push({ text: child.status === "complete" ? `${child.label} · ${child.results?.[1] ?? "done"}` : child.label, kind: "search", complete: child.status === "complete" });
    }
    if (retrieve && !children.length) {
      lines.push({ text: retrieve.status === "complete" ? `Selected documents searched · ${retrieve.results?.[1] ?? ""}` : "Searching selected documents", kind: "search", complete: retrieve.status === "complete" });
    }
    blocks.push({ id: "research", icon: "🔬", title: retrieve?.status === "complete" ? "Researched" : "Researching…", divider: true, lines });
  }
  const assess = byId.get("assess");
  if (assess) {
    const lines: { text: string; kind: "search" | "web"; complete: boolean }[] = [
      { text: assess.status === "complete" ? `Coverage: ${assess.results?.[0] ?? ""}` : "Checking document evidence coverage", kind: "search", complete: assess.status === "complete" },
    ];
    const web = byId.get("web");
    if (web) lines.push({ text: `Web research · ${web.results?.[0] ?? ""}`, kind: "web", complete: true });
    blocks.push({ id: "assess", icon: "🔎", title: assess.status === "complete" ? "Evidence checked" : "Checking evidence…", divider: true, lines });
  }
  return blocks;
}

function verdictOf(steps: ChatStep[]) {
  return steps.find((s) => s.id === "assess")?.results?.includes("Partial evidence") ? "partial" : "sufficient";
}

/** Citation markers as small colored superscript-style chips; not interactive in design B. */
function StageAnswer({ text }: { text: string }) {
  return (
    <>
      {text.split(/\s?(\[\d\])/).map((part, index) =>
        /^\[\d\]$/.test(part) ? (
          <span key={index} className="ml-1 rounded bg-blue-500/15 px-1 text-sm text-blue-300">
            {part}
          </span>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </>
  );
}
