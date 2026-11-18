"use client";

import { ArrowUp, FileText, MessageCircleQuestion, Play, RotateCcw } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";

import { demoLesson, demoTutor, tutorFrameAt, tutorScriptDuration } from "@/content/landing-demo";
import { usePrefersReducedMotion, useRenderActivity } from "@/core/dom/render-activity";
import { cn } from "@/lib/utils";

const TICK_MS = 50;
const MAX_STEP_MS = 1000;

/**
 * The lesson tutor from Master mode, scripted for Lesson 4 · Pods: a typed question gets
 * a guiding hint, then "Just tell me the answer" gets the answer. No model calls.
 * Plays once when it scrolls into view; fills the space it is given and scrolls inside.
 */
export function TutorDemo({ className }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  const visible = useRenderActivity(ref, false);
  const reduced = usePrefersReducedMotion();
  const [elapsed, setElapsed] = useState(0);
  const [started, setStarted] = useState(false);
  const shown = reduced ? tutorScriptDuration : elapsed;
  const done = shown >= tutorScriptDuration;

  useEffect(() => {
    if (!visible || started || reduced) return;
    const timer = setTimeout(() => setStarted(true), 600);
    return () => clearTimeout(timer);
  }, [visible, started, reduced]);

  useEffect(() => {
    if (!started || !visible || done || reduced) return;
    let last = Date.now();
    const timer = setInterval(() => {
      const now = Date.now();
      const delta = Math.min(now - last, MAX_STEP_MS);
      last = now;
      setElapsed((value) => Math.min(tutorScriptDuration, value + delta));
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [started, visible, done, reduced]);

  const frame = tutorFrameAt(shown);
  const turns = demoTutor.turns.slice(0, frame.sent);

  useEffect(() => {
    const chat = chatRef.current;
    if (chat && shown > 0) chat.scrollTo?.({ top: chat.scrollHeight, behavior: reduced ? "auto" : "smooth" });
  }, [frame.sent, frame.chars, frame.thinking, shown, reduced]);

  const replay = () => {
    setElapsed(0);
    setStarted(true);
  };

  return (
    <div
      ref={ref}
      data-tutor-demo
      data-tutor-done={done ? "" : undefined}
      className={cn("flex min-h-[20rem] flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/50", className)}
    >
      <div className="flex items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <MessageCircleQuestion size={15} aria-hidden="true" className="shrink-0 text-zinc-400" />
          <span className="truncate text-sm text-zinc-300">
            Tutor · Lesson {demoLesson.number} · {demoLesson.title}
          </span>
        </div>
        <button
          type="button"
          onClick={replay}
          aria-label={started ? "Replay the tutor demo" : "Play the tutor demo"}
          className="flex size-7 shrink-0 items-center justify-center rounded-full bg-white/10 text-white transition-all hover:bg-white/20 active:scale-95"
        >
          {started || reduced ? <RotateCcw size={13} aria-hidden="true" /> : <Play size={13} aria-hidden="true" />}
        </button>
      </div>

      <div ref={chatRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite">
        <p className="text-xs leading-5 text-zinc-500">
          Ask about this lesson. I&apos;ll guide you first; ask for the answer whenever you want it.
        </p>
        {turns.map((turn, index) => {
          const answered = index < frame.answered;
          const text = answered ? turn.answer : turn.answer.slice(0, frame.chars);
          const thinking = !answered && frame.thinking;
          return (
            <div key={turn.question} className="space-y-3">
              <motion.div
                initial={reduced ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex justify-end"
              >
                <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-blue-600 px-3.5 py-2 text-sm text-white">{turn.question}</div>
              </motion.div>
              {thinking && (
                <div role="status" className="flex items-center gap-1.5 text-xs text-zinc-500">
                  <span className="flex gap-1" aria-hidden="true">
                    {[0, 1, 2].map((dot) => (
                      <span key={dot} className="size-1.5 animate-pulse rounded-full bg-zinc-500" style={{ animationDelay: `${dot * 150}ms` }} />
                    ))}
                  </span>
                  Reading the lesson…
                </div>
              )}
              {text && (
                <div data-tutor-answer={index} className="text-sm leading-6 text-zinc-300">
                  <p>{text}</p>
                  {answered && (
                    <motion.p
                      initial={reduced ? false : { opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="mt-2 flex items-start gap-1.5 text-xs text-zinc-500"
                    >
                      <FileText size={12} aria-hidden="true" className="mt-0.5 shrink-0" />
                      <span>“{turn.source}”</span>
                    </motion.p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="space-y-2 border-t border-zinc-800 p-3">
        <div className="flex flex-wrap gap-1.5" aria-hidden="true">
          {demoTutor.chips.map((chip) => (
            <span
              key={chip}
              className={cn(
                "rounded-full border px-2.5 py-1 text-[11px] transition-all duration-200",
                frame.chip === chip
                  ? "scale-95 border-blue-500/60 bg-blue-600/20 text-white"
                  : "border-zinc-700 text-zinc-400",
              )}
            >
              {chip}
            </span>
          ))}
        </div>
        {/* Decorative input: shows the question being typed. */}
        <div className="flex items-center gap-2 rounded-xl bg-zinc-800 px-3 py-2 text-sm" aria-hidden="true">
          <span className={cn("min-w-0 flex-1 truncate", frame.draft ? "text-zinc-200" : "text-zinc-500")}>
            {frame.draft || "Ask about this lesson…"}
            <AnimatePresence>
              {frame.draft && (
                <motion.span
                  initial={{ opacity: 0 }}
                  animate={{ opacity: [1, 0, 1] }}
                  exit={{ opacity: 0 }}
                  transition={{ repeat: Infinity, duration: 1 }}
                  className="ml-px inline-block h-4 w-px translate-y-0.5 bg-zinc-300"
                />
              )}
            </AnimatePresence>
          </span>
          <span
            className={cn(
              "flex size-6 shrink-0 items-center justify-center rounded-full transition-colors",
              frame.draft ? "bg-blue-600 text-white" : "bg-zinc-700 text-zinc-500",
            )}
          >
            <ArrowUp size={13} />
          </span>
        </div>
      </div>
    </div>
  );
}
