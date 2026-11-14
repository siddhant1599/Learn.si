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
 * Six sentences on a synthetic page travel to their places as named stars while
 * the hero scrolls. Positions are written straight to the DOM from update(p);
 * React renders this tree once.
 */
export type ConstellationHandle = { update: (progress: number) => void };

const { stars: STARS, modules: MODULES } = site.hero.constellation;
// Pairs of star indexes joined by a line; the 2–3 link bridges the modules faintly.
const LINES: [number, number, boolean][] = [
  [0, 1, false],
  [1, 2, false],
  [3, 4, false],
  [4, 5, false],
  [2, 3, true],
];
const GOLD = "#e9c665";

const clamp = (value: number) => Math.min(1, Math.max(0, value));
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Final star layout as fractions of the stage; narrow stages spread wider. */
function targets(width: number, height: number): [number, number][] {
  const narrow = width < 640;
  const left = narrow ? [0.2, 0.34, 0.24] : [0.24, 0.36, 0.3];
  const right = narrow ? [0.66, 0.8, 0.74] : [0.64, 0.76, 0.7];
  const rows = narrow ? [0.6, 0.7, 0.83] : [0.58, 0.68, 0.8];
  return [
    [left[0]! * width, rows[0]! * height],
    [left[1]! * width, rows[1]! * height],
    [left[2]! * width, rows[2]! * height],
    [right[0]! * width, rows[0]! * height],
    [right[1]! * width, rows[1]! * height],
    [right[2]! * width, rows[2]! * height],
  ];
}

export const ConstellationScene = forwardRef<
  ConstellationHandle,
  { className?: string }
>(function ConstellationScene({ className }, ref) {
  const stage = useRef<HTMLDivElement>(null);
  const page = useRef<HTMLDivElement>(null);
  const sentences = useRef<(HTMLSpanElement | null)[]>([]);
  const starNodes = useRef<(SVGGElement | null)[]>([]);
  const lineNodes = useRef<(SVGLineElement | null)[]>([]);
  const labelNodes = useRef<(SVGTextElement | null)[]>([]);
  const moduleNodes = useRef<(SVGTextElement | null)[]>([]);
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
    current.current = STARS.map((_, index) => {
      const local = clamp((p - index * 0.07) / 0.55);
      const t = easeOut(local);
      const [ox, oy] = origins.current[index] ?? [0, 0];
      const [tx, ty] = ends.current[index] ?? [0, 0];
      const node = starNodes.current[index];
      if (node) {
        node.style.transform = `translate(${lerp(ox, tx, t)}px, ${lerp(oy, ty, t)}px) scale(${0.4 + 0.6 * t})`;
        node.style.opacity = String(clamp(local * 2.5));
      }
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
      const draw = clamp((p - 0.5 - index * 0.04) / 0.3);
      node.style.strokeDashoffset = String(1 - draw);
    });
    const reveal = clamp((p - 0.72) / 0.24);
    const narrow = width < 640;
    labelNodes.current.forEach((node, index) => {
      const point = current.current[index];
      if (!node || !point) return;
      if (narrow) {
        // Beside-the-star labels run off a phone screen; sit them under the star instead.
        node.setAttribute("x", String(point[0]));
        node.setAttribute("y", String(point[1] + 22));
        node.setAttribute("text-anchor", "middle");
      } else {
        const leftSide = point[0] < width / 2;
        node.setAttribute("x", String(point[0] + (leftSide ? -14 : 14)));
        node.setAttribute("y", String(point[1] + 4));
        node.setAttribute("text-anchor", leftSide ? "end" : "start");
      }
      node.style.opacity = String(reveal);
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
    if (page.current) {
      page.current.style.opacity = String(1 - clamp(p / 0.6));
      page.current.style.transform = `translate(-50%, ${-28 * clamp(p / 0.6)}px)`;
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

  return (
    <div ref={stage} className={className} aria-hidden="true" data-constellation>
      <div
        ref={page}
        data-constellation-page
        className="absolute bottom-[7svh] left-1/2 w-[min(92vw,34rem)] rounded-xl border border-white/15 bg-white/[0.03] p-5 shadow-2xl backdrop-blur-sm sm:p-6"
        // Centering lives in the inline transform that update() also animates.
        style={{ transform: "translate(-50%, 0)" }}
      >
        <div className="mb-3 flex items-center justify-between text-[11px] tracking-widest text-white/50 uppercase">
          <span>{site.hero.constellation.source}</span>
          <span>Source excerpt</span>
        </div>
        <p className="font-serif text-base leading-7 text-white/85 sm:text-lg sm:leading-8">
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
            <circle r={3} fill="#fff" />
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
            style={{ opacity: 0, textTransform: "uppercase" }}
          >
            {title.toUpperCase()}
          </text>
        ))}
      </svg>
    </div>
  );
});
