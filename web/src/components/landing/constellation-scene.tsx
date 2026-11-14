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
 * React renders this tree once.
 */
export type ConstellationHandle = { update: (progress: number) => void };

const { stars: STARS, modules: MODULES } = site.constellation;
const GOLD = "#e9c665";
const MASTERED_MODULE = 0;
const NEXT_STAR = STARS.findIndex((star) => star.module === MASTERED_MODULE + 1);

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

export const ConstellationScene = forwardRef<
  ConstellationHandle,
  { className?: string }
>(function ConstellationScene({ className }, ref) {
  const stage = useRef<HTMLDivElement>(null);
  const page = useRef<HTMLDivElement>(null);
  const legend = useRef<HTMLDivElement>(null);
  const sentences = useRef<(HTMLSpanElement | null)[]>([]);
  const starNodes = useRef<(SVGGElement | null)[]>([]);
  const coreNodes = useRef<(SVGCircleElement | null)[]>([]);
  const ringNodes = useRef<(SVGCircleElement | null)[]>([]);
  const lineNodes = useRef<(SVGLineElement | null)[]>([]);
  const labelNodes = useRef<(SVGTextElement | null)[]>([]);
  const moduleNodes = useRef<(SVGTextElement | null)[]>([]);
  const chip = useRef<SVGTextElement>(null);
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
    current.current = STARS.map((star, index) => {
      const local = clamp((p - index * 0.045) / 0.5);
      const t = easeOut(local);
      const [ox, oy] = origins.current[index] ?? [0, 0];
      const [tx, ty] = ends.current[index] ?? [0, 0];
      const node = starNodes.current[index];
      const mastered = star.module === MASTERED_MODULE;
      const next = index === NEXT_STAR;
      const locked = !mastered && !next;
      if (node) {
        const scale = 0.4 + 0.6 * t + (mastered ? 0.35 * path : next ? 0.2 * path : 0);
        node.style.transform = `translate(${lerp(ox, tx, t)}px, ${lerp(oy, ty, t)}px) scale(${scale})`;
        node.style.opacity = String(clamp(local * 2.5) * (locked ? 1 - 0.55 * path : 1));
      }
      const core = coreNodes.current[index];
      if (core) core.setAttribute("fill", mastered && path > 0.5 ? GOLD : "#ffffff");
      const ring = ringNodes.current[index];
      if (ring) ring.style.opacity = String(mastered ? path : next ? path * 0.7 : 0);
      return [lerp(ox, tx, t), lerp(oy, ty, t)];
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
      node.setAttribute("font-size", narrow ? "11" : "13");
      if (narrow) {
        node.setAttribute("x", String(point[0]));
        node.setAttribute("y", String(point[1] + 22));
        node.setAttribute("text-anchor", "middle");
      } else {
        const leftSide = point[0] < width / 2;
        node.setAttribute("x", String(point[0] + (leftSide ? -14 : 14)));
        node.setAttribute("y", String(point[1] + 4));
        node.setAttribute("text-anchor", leftSide ? "end" : "start");
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
      node.setAttribute("x", String(x));
      node.setAttribute("y", String(top - 34));
      node.style.opacity = String(reveal);
    });
    const nextPoint = current.current[NEXT_STAR];
    if (chip.current && nextPoint) {
      chip.current.setAttribute("x", String(nextPoint[0]));
      chip.current.setAttribute("y", String(nextPoint[1] + (narrow ? 40 : 26)));
      chip.current.style.opacity = String(path);
    }
    if (legend.current) legend.current.style.opacity = String(path);
    if (page.current) {
      page.current.style.opacity = String(1 - clamp(p / 0.55));
      page.current.style.transform = `translate(-50%, ${-28 * clamp(p / 0.55)}px)`;
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
        className="absolute bottom-[9svh] left-1/2 w-[min(92vw,36rem)] rounded-xl border border-white/15 bg-white/[0.03] p-5 shadow-2xl backdrop-blur-sm sm:p-6"
        // Centering lives in the inline transform that update() also animates.
        style={{ transform: "translate(-50%, 0)" }}
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
      <svg className="absolute inset-0 size-full overflow-visible">
        <defs>
          <radialGradient id="constellation-glow">
            <stop offset="0%" stopColor={GOLD} stopOpacity="0.9" />
            <stop offset="100%" stopColor={GOLD} stopOpacity="0" />
          </radialGradient>
        </defs>
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
        {STARS.map((star, index) => (
          <g
            key={star.label}
            ref={(node) => {
              starNodes.current[index] = node;
            }}
            data-constellation-star
            style={{ opacity: 0, transformOrigin: "0 0" }}
          >
            <circle r={18} fill="url(#constellation-glow)" opacity={0.55} />
            <circle
              ref={(node) => {
                ringNodes.current[index] = node;
              }}
              r={8}
              fill="none"
              stroke={GOLD}
              strokeWidth={1.25}
              style={{ opacity: 0 }}
            />
            <circle
              ref={(node) => {
                coreNodes.current[index] = node;
              }}
              r={3}
              fill="#ffffff"
            />
          </g>
        ))}
        {STARS.map((star, index) => (
          <text
            key={star.label}
            ref={(node) => {
              labelNodes.current[index] = node;
            }}
            data-constellation-label
            fill="rgba(255,255,255,0.86)"
            fontSize={13}
            style={{ opacity: 0 }}
          >
            {star.label}
          </text>
        ))}
        {MODULES.map((title, index) => (
          <text
            key={title}
            ref={(node) => {
              moduleNodes.current[index] = node;
            }}
            textAnchor="middle"
            fill={GOLD}
            fontSize={11}
            letterSpacing={3}
            style={{ opacity: 0 }}
          >
            {title.toUpperCase()}
          </text>
        ))}
        <text
          ref={chip}
          data-constellation-chip
          textAnchor="middle"
          fill={GOLD}
          fontSize={12}
          style={{ opacity: 0 }}
        >
          {nextLesson}
        </text>
      </svg>
      <div
        ref={legend}
        data-constellation-legend
        className="absolute bottom-5 left-1/2 flex w-[min(92vw,40rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-x-5 gap-y-1 text-[11px] tracking-wide text-white/60"
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
