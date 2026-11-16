"use client";

import { useEffect, useRef, useState } from "react";

import { site } from "@/config/site";
import { usePrefersReducedMotion } from "@/core/dom/render-activity";
import { cn } from "@/lib/utils";

import { ConstellationScene, type ConstellationHandle } from "./constellation-scene";
import { LessonCard } from "./lesson-card";
import { ProgressPanel } from "./progress-panel";

const INITIAL_COMPLETED = 3; // Module one mastered when the visitor arrives.

/**
 * A 220svh scroll stage with a sticky viewport placed after the examples. The
 * first 120svh of scrolling drives --stage-progress and the constellation's
 * three acts. Reduced motion shows the finished map in a plain 100svh frame.
 */
export function ConstellationSection({ className }: { className?: string }) {
  const reduced = usePrefersReducedMotion();
  const stage = useRef<HTMLDivElement>(null);
  const scene = useRef<ConstellationHandle>(null);
  const [completed, setCompleted] = useState(INITIAL_COMPLETED);
  const [quizFirstTry, setQuizFirstTry] = useState<boolean | null>(null);
  const pass = (firstTry: boolean) => {
    setCompleted((count) => Math.max(count, INITIAL_COMPLETED + 1));
    setQuizFirstTry((value) => value ?? firstTry);
    scene.current?.setCompleted(INITIAL_COMPLETED + 1);
  };

  useEffect(() => {
    let last = -1;
    const apply = (p: number) => {
      // Outside the stage p is pinned at 0 or 1: skip the DOM work entirely.
      if (p === last) return;
      last = p;
      stage.current?.style.setProperty("--stage-progress", String(p));
      scene.current?.update(p);
    };
    if (reduced) {
      apply(1);
      return;
    }
    let frame: number | undefined;
    let near = true;
    const read = () => {
      frame = undefined;
      const el = stage.current;
      if (!el) return;
      // No layout yet (offsetHeight 0) is the start state; a stage that cannot scroll is finished.
      const total = el.offsetHeight - window.innerHeight;
      const p = el.offsetHeight === 0
        ? 0
        : total > 0 ? Math.min(1, Math.max(0, -el.getBoundingClientRect().top / total)) : 1;
      apply(p);
    };
    const schedule = () => {
      // Scrolling elsewhere on the page costs nothing: no frame is even scheduled.
      if (near && frame === undefined) frame = requestAnimationFrame(read);
    };
    // Track whether the stage is within a screen of the viewport; settle its
    // pinned value once when it leaves so a fast scroll never strands a half state.
    const observer =
      typeof IntersectionObserver === "undefined"
        ? undefined
        : new IntersectionObserver(
            ([entry]) => {
              near = entry?.isIntersecting ?? true;
              read();
            },
            { rootMargin: "100% 0px" },
          );
    if (stage.current) observer?.observe(stage.current);
    read();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [reduced]);

  const copy = site.constellation;
  return (
    <section
      id="path"
      aria-labelledby="path-title"
      className={cn("mx-auto flex w-full min-w-0 flex-col py-8", className)}
    >
      <div
        ref={stage}
        data-constellation-stage
        className={cn("relative", reduced ? "h-svh" : "h-[220svh]")}
        style={{ "--stage-progress": reduced ? 1 : 0 } as React.CSSProperties}
      >
        <div className="sticky top-0 h-svh overflow-hidden">
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,#1b1711_0%,#0a0a0a_70%)]"
          />
          <ConstellationScene ref={scene} className="absolute inset-0" />
          {/* The heading lives inside the pinned frame so it stays while the map forms. */}
          <header className="relative z-10 mx-auto flex max-w-3xl flex-col items-center px-4 pt-[11svh] text-center sm:pt-[12svh]">
            <p className="mb-3 text-[11px] font-semibold tracking-widest text-[#e9c665] uppercase">
              {copy.eyebrow}
            </p>
            <h2
              id="path-title"
              // Padding keeps glyph overhang and descenders inside the clipped gradient box.
              className="mb-2 max-w-full bg-linear-to-r from-white via-gray-200 to-gray-400 bg-clip-text px-2 pb-1.5 text-3xl leading-tight font-bold break-words text-transparent sm:text-4xl md:text-5xl"
            >
              {copy.title}
            </h2>
            <p className="text-muted-foreground max-w-2xl text-sm break-words sm:text-lg md:text-xl">
              {copy.subtitle}
            </p>
            <p className="sr-only">{copy.caption}</p>
          </header>
          {!reduced && (
            <div
              aria-hidden="true"
              className="absolute bottom-5 left-1/2 -translate-x-1/2 text-[11px] tracking-widest text-white/45 uppercase"
              style={{ opacity: "calc(1 - var(--stage-progress, 0) * 4)" }}
            >
              Scroll
            </div>
          )}
        </div>
      </div>
      {/* The next lesson, playable: passing its quiz lights Pods on the map above. */}
      <div className="mx-auto mt-10 w-full max-w-6xl px-4">
        <div className="mb-6 max-w-2xl">
          <h3 className="font-serif text-2xl text-white sm:text-3xl">Open the next lesson</h3>
        </div>
        <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr] lg:items-start">
          <LessonCard onPass={pass} passed={completed > INITIAL_COMPLETED} />
          <ProgressPanel
            completed={completed}
            quizFirstTry={quizFirstTry}
            className="lg:sticky lg:top-24"
          />
        </div>
      </div>
    </section>
  );
}
