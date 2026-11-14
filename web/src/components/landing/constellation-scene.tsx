"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";

import { site } from "@/config/site";

/**
 * Three acts driven by progress p in [0, 1], written straight to the DOM:
 *   1. 0.00–0.50  sentences lift off the page and travel to their star positions
 *   2. 0.45–0.75  lines draw within modules, labels and module names fade in
 *   3. 0.75–1.00  the path shows: module one mastered (gold), the next lesson lit,
 *                 the rest dimmed as locked; a legend explains the states
 *
 * Stars, labels and titles are HTML layers moved with translate3d so each frame is
 * compositor work only; the SVG holds just the lines. React renders this tree once.
 */
export type ConstellationHandle = { update: (progress: number) => void };

const { stars: STARS, modules: MODULES } = site.constellation;
const GOLD = "#e9c665";
const MASTERED_MODULE = 0;
const NEXT_STAR = STARS.findIndex((star) => star.module === MASTERED_MODULE + 1);
const STAR_BOX = 36; // px; the glow's diameter and the layer's size

// Consecutive stars inside a module; the last of one module bridges (dashed) to the next.
const LINES: [number, number, boolean][] = [];
STARS.forEach((star, index) => {
  const next = STARS[index + 1];
  if (!next) return;
  LINES.push([index, index + 1, next.module !== star.module]);
});

const clamp = (value: number) => Math.min(1, Math.max(0, value));
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const LAYER = "absolute top-0 left-0 will-change-[transform,opacity]";

/** Final layout: one column per module, a gentle zigzag inside each column. */
function targets(width: number, height: number): [number, number][] {
  const narrow = width < 640;
  // Narrow stages keep columns straight so under-star labels never collide.
  const columns = narrow ? [0.17, 0.5, 0.83] : [0.2, 0.5, 0.8];
  const rows = narrow ? [0.54, 0.68, 0.82] : [0.52, 0.66, 0.8];
  const wobble = narrow ? [0, 0, 0] : [-0.06, 0.06, -0.02];
  const counters = MODULES.map(() => 0);
  return STARS.map((star) => {
    const row = counters[star.module]!++;
    return [
      (columns[star.module]! + wobble[row]!) * width,
      rows[row]! * height,
    ];
  });
}

function setState(node: HTMLElement | null, value: string) {
  if (node && node.dataset.state !== value) node.dataset.state = value;
}

export const ConstellationScene = forwardRef<
  ConstellationHandle,
  { className?: string }
>(function ConstellationScene({ className }, ref) {
  const stage = useRef<HTMLDivElement>(null);
  const page = useRef<HTMLDivElement>(null);
  const legend = useRef<HTMLDivElement>(null);
  const chip = useRef<HTMLDivElement>(null);
  const sentences = useRef<(HTMLSpanElement | null)[]>([]);
  const starNodes = useRef<(HTMLDivElement | null)[]>([]);
  const lineNodes = useRef<(SVGLineElement | null)[]>([]);
  const labelNodes = useRef<(HTMLDivElement | null)[]>([]);
  const moduleNodes = useRef<(HTMLDivElement | null)[]>([]);
  const origins = useRef<[number, number][]>([]);
  const ends = useRef<[number, number][]>([]);
  const current = useRef<[number, number][]>([]);
  const progress = useRef(0);

  const measure = useCallback(() => {
    const bounds = stage.current?.getBoundingClientRect();
    if (!bounds || !bounds.width) return;
    origins.current = sentences.current.map((node) => {
      const rect = node?.getBoundingClientRect();
      return rect
        ? [rect.left + rect.width / 2 - bounds.left, rect.top + rect.height / 2 - bounds.top]
        : [bounds.width / 2, bounds.height * 0.8];
    });
    ends.current = targets(bounds.width, bounds.height);
  }, []);

  const update = useCallback((p: number) => {
    progress.current = p;
    if (!origins.current.length) measure();
    const width = stage.current?.clientWidth ?? 0;
    const narrow = width < 640;
    const path = clamp((p - 0.78) / 0.18); // Act three
    const half = STAR_BOX / 2;
    current.current = STARS.map((star, index) => {
      const local = clamp((p - index * 0.045) / 0.5);
      const t = easeOut(local);
      const [ox, oy] = origins.current[index] ?? [0, 0];
      const [tx, ty] = ends.current[index] ?? [0, 0];
      const x = lerp(ox, tx, t);
      const y = lerp(oy, ty, t);
      const node = starNodes.current[index];
      const mastered = star.module === MASTERED_MODULE;
      const next = index === NEXT_STAR;
      const locked = !mastered && !next;
      if (node) {
        const scale = 0.4 + 0.6 * t + (mastered ? 0.35 * path : next ? 0.2 * path : 0);
        node.style.transform = `translate3d(${x - half}px, ${y - half}px, 0) scale(${scale})`;
        node.style.opacity = String(clamp(local * 2.5) * (locked ? 1 - 0.55 * path : 1));
        setState(node, path > 0.5 ? (mastered ? "mastered" : next ? "next" : "locked") : "forming");
      }
      return [x, y];
    });
    LINES.forEach(([a, b], index) => {
      const node = lineNodes.current[index];
      const from = current.current[a];
      const to = current.current[b];
      if (!node || !from || !to) return;
      node.setAttribute("x1", String(from[0]));
      node.setAttribute("y1", String(from[1]));
      node.setAttribute("x2", String(to[0]));
      node.setAttribute("y2", String(to[1]));
      node.style.strokeDashoffset = String(1 - clamp((p - 0.45 - index * 0.025) / 0.3));
    });
    const reveal = clamp((p - 0.62) / 0.2);
    labelNodes.current.forEach((node, index) => {
      const point = current.current[index];
      if (!node || !point) return;
      if (narrow) {
        node.style.transform = `translate3d(${point[0]}px, ${point[1] + 12}px, 0) translate(-50%, 0)`;
      } else {
        const leftSide = point[0] < width / 2;
        node.style.transform = `translate3d(${point[0] + (leftSide ? -14 : 14)}px, ${point[1]}px, 0) translate(${leftSide ? "-100%" : "0"}, -50%)`;
      }
      const locked = STARS[index]!.module !== MASTERED_MODULE && index !== NEXT_STAR;
      node.style.opacity = String(reveal * (locked ? 1 - 0.45 * path : 1));
    });
    moduleNodes.current.forEach((node, moduleIndex) => {
      if (!node) return;
      const members = current.current.filter((_, i) => STARS[i]!.module === moduleIndex);
      if (!members.length) return;
      const top = Math.min(...members.map((m) => m[1]));
      const x = members.reduce((sum, m) => sum + m[0], 0) / members.length;
      node.style.transform = `translate3d(${x}px, ${top - 44}px, 0) translate(-50%, 0)`;
      node.style.opacity = String(reveal);
    });
    const nextPoint = current.current[NEXT_STAR];
    if (chip.current && nextPoint) {
      chip.current.style.transform = `translate3d(${nextPoint[0]}px, ${nextPoint[1] + (narrow ? 30 : 14)}px, 0) translate(-50%, 0)`;
      chip.current.style.opacity = String(path);
    }
    if (legend.current) legend.current.style.opacity = String(path);
    if (page.current) {
      const fade = clamp(p / 0.55);
      page.current.style.opacity = String(1 - fade);
      page.current.style.transform = `translate3d(-50%, ${-28 * fade}px, 0)`;
    }
  }, [measure]);

  useImperativeHandle(ref, () => ({ update }), [update]);

  useEffect(() => {
    measure();
    update(progress.current);
    if (!stage.current || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      measure();
      update(progress.current);
    });
    observer.observe(stage.current);
    return () => observer.disconnect();
  }, [measure, update]);

  const { source, states, nextLesson } = site.constellation;
  return (
    <div ref={stage} className={className} aria-hidden="true" data-constellation>
      <div
        ref={page}
        data-constellation-page
        className="absolute bottom-[9svh] left-1/2 w-[min(92vw,36rem)] rounded-xl border border-white/15 bg-[#14110c]/90 p-5 shadow-2xl will-change-[transform,opacity] sm:p-6"
        // Centering lives in the inline transform that update() also animates.
        style={{ transform: "translate3d(-50%, 0, 0)" }}
      >
        <div className="mb-3 flex items-center justify-between gap-4 text-[11px] tracking-widest text-white/50 uppercase">
          <span>{source}</span>
          <span>Source excerpt</span>
        </div>
        <p className="font-serif text-[15px] leading-7 text-white/85 sm:text-lg sm:leading-8">
          {STARS.map((star, index) => (
            <span
              key={star.label}
              ref={(node) => {
                sentences.current[index] = node;
              }}
              data-constellation-sentence
            >
              {star.sentence}{" "}
            </span>
          ))}
        </p>
      </div>
      <svg className="pointer-events-none absolute inset-0 size-full overflow-visible will-change-transform">
        {LINES.map(([a, b, bridge], index) => (
          <line
            key={`${a}-${b}`}
            ref={(node) => {
              lineNodes.current[index] = node;
            }}
            pathLength={1}
            stroke={bridge ? "rgba(255,255,255,0.18)" : "rgba(233,198,101,0.45)"}
            strokeWidth={1}
            strokeDasharray={bridge ? "0.02 0.02" : 1}
            style={{ strokeDashoffset: 1 }}
          />
        ))}
      </svg>
      {STARS.map((star, index) => (
        <div
          key={star.label}
          ref={(node) => {
            starNodes.current[index] = node;
          }}
          data-constellation-star
          data-state="forming"
          className={`${LAYER} group/star grid place-items-center rounded-full`}
          style={{ width: STAR_BOX, height: STAR_BOX, opacity: 0, transformOrigin: "50% 50%" }}
        >
          <span className="absolute inset-0 rounded-full bg-[radial-gradient(circle,rgba(233,198,101,0.55)_0%,rgba(233,198,101,0)_70%)]" />
          <span className="absolute size-4 rounded-full border border-[#e9c665] opacity-0 transition-opacity duration-300 group-data-[state=mastered]/star:opacity-100 group-data-[state=next]/star:opacity-70" />
          <span className="relative size-1.5 rounded-full bg-white transition-colors duration-300 group-data-[state=mastered]/star:bg-[#e9c665]" />
        </div>
      ))}
      {STARS.map((star, index) => (
        <div
          key={star.label}
          ref={(node) => {
            labelNodes.current[index] = node;
          }}
          data-constellation-label
          className={`${LAYER} text-[11px] whitespace-nowrap text-white/85 sm:text-[13px]`}
          style={{ opacity: 0 }}
        >
          {star.label}
        </div>
      ))}
      {MODULES.map((title, index) => (
        <div
          key={title}
          ref={(node) => {
            moduleNodes.current[index] = node;
          }}
          className={`${LAYER} text-[11px] font-semibold tracking-[0.3em] whitespace-nowrap text-[#e9c665] uppercase`}
          style={{ opacity: 0 }}
        >
          {title}
        </div>
      ))}
      <div
        ref={chip}
        data-constellation-chip
        className={`${LAYER} text-[12px] whitespace-nowrap text-[#e9c665]`}
        style={{ opacity: 0 }}
      >
        {nextLesson}
      </div>
      <div
        ref={legend}
        data-constellation-legend
        className="absolute bottom-5 left-1/2 flex w-[min(92vw,40rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-x-5 gap-y-1 text-[11px] tracking-wide text-white/60 will-change-[opacity]"
        style={{ opacity: 0 }}
      >
        <span className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-[#e9c665] ring-2 ring-[#e9c665]/40" />
          {states.mastered}
        </span>
        <span className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-white ring-2 ring-[#e9c665]/40" />
          {states.available}
        </span>
        <span className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-white/40" />
          {states.locked}
        </span>
      </div>
    </div>
  );
});
