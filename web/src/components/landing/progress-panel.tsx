"use client";

import { useId, useState } from "react";

import { site } from "@/config/site";
import { demoProgress, demoWeek } from "@/content/landing-demo";
import { cn } from "@/lib/utils";

const GOLD = "#e9c665";

/**
 * Progress as a small night sky plus the numbers the progress API (#26) will return.
 * `completed` is the live count; the scrubber replays an example week up to today.
 */
export function ProgressPanel({
  completed,
  quizFirstTry,
  className,
}: {
  completed: number;
  quizFirstTry: boolean | null;
  className?: string;
}) {
  const [day, setDay] = useState(demoWeek.length - 1);
  const isToday = day === demoWeek.length - 1;
  const shown = isToday ? completed : Math.min(demoWeek[day]!.completed, completed);
  const progress = demoProgress(shown, isToday ? quizFirstTry : null);
  const sliderId = useId();
  const stars = site.constellation.stars;

  return (
    <section
      aria-labelledby={`${sliderId}-title`}
      data-progress-panel
      data-completed={shown}
      className={cn("rounded-2xl border border-white/15 bg-[#14110c]/95 p-6 shadow-2xl sm:p-8", className)}
    >
      <p className="text-[11px] tracking-widest text-white/50 uppercase">Progress · example week</p>
      <h3 id={`${sliderId}-title`} className="mt-3 font-serif text-3xl leading-none text-white">
        Your sky, filling in
      </h3>
      <p className="mt-3 text-sm text-white/70">
        Each star is a lesson. Gold is mastered, white is open, dim is still locked.
      </p>

      <MiniSky completed={shown} />

      <dl className="mt-6 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
        <Stat label="Lessons" value={`${progress.completed}/${progress.total}`} />
        <Stat label="Course" value={`${progress.percent}%`} />
        <Stat label="Study time" value={formatMinutes(progress.studyMinutes)} />
        <Stat label="Quiz" value={progress.quiz} />
      </dl>
      <ul className="mt-4 flex flex-wrap gap-2">
        {progress.modules.map((module) => (
          <li
            key={module.title}
            className={cn(
              "rounded-full border px-3 py-1 text-xs",
              module.level === "Mastered"
                ? "border-[#e9c665]/50 text-[#e9c665]"
                : module.level === "Developing"
                  ? "border-white/30 text-white/85"
                  : "border-white/10 text-white/45",
            )}
          >
            {module.title} · {module.level}
          </li>
        ))}
      </ul>

      <div className="mt-6">
        <div className="flex items-center justify-between text-xs text-white/60">
          <label htmlFor={sliderId}>Replay the week</label>
          <span aria-live="polite">{demoWeek[day]!.day}</span>
        </div>
        <input
          id={sliderId}
          type="range"
          min={0}
          max={demoWeek.length - 1}
          value={day}
          onChange={(event) => setDay(Number(event.target.value))}
          className="mt-2 w-full accent-[#e9c665]"
        />
        <div className="mt-1 flex justify-between text-[10px] tracking-wide text-white/40 uppercase">
          {demoWeek.map((entry) => (
            <span key={entry.day}>{entry.day === "Today" ? "Now" : entry.day}</span>
          ))}
        </div>
      </div>
    </section>
  );

  function MiniSky({ completed }: { completed: number }) {
    const width = 320;
    const height = 96;
    const columns = [0.17, 0.5, 0.83];
    const rows = [0.3, 0.55, 0.8];
    const wobble = [-0.07, 0.07, -0.02];
    const counters = [0, 0, 0];
    const points = stars.map((star) => {
      const row = counters[star.module]!++;
      return [(columns[star.module]! + wobble[row]!) * width, rows[row]! * height] as const;
    });
    return (
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="mt-6 h-28 w-full"
        role="img"
        aria-label={`${completed} of ${stars.length} lessons complete`}
        data-mini-sky
      >
        {points.slice(0, -1).map((from, index) => {
          const to = points[index + 1]!;
          const bridge = stars[index]!.module !== stars[index + 1]!.module;
          const lit = index + 1 <= completed;
          return (
            <line
              key={index}
              x1={from[0]}
              y1={from[1]}
              x2={to[0]}
              y2={to[1]}
              stroke={bridge ? "rgba(255,255,255,0.15)" : lit ? "rgba(233,198,101,0.6)" : "rgba(255,255,255,0.18)"}
              strokeDasharray={bridge ? "2 3" : undefined}
            />
          );
        })}
        {points.map(([x, y], index) => {
          const state = index < completed ? "mastered" : index === completed ? "next" : "locked";
          return (
            <g key={stars[index]!.label} data-state={state}>
              {state !== "locked" && <circle cx={x} cy={y} r={9} fill={GOLD} opacity={state === "mastered" ? 0.18 : 0.1} />}
              {state !== "locked" && <circle cx={x} cy={y} r={5} fill="none" stroke={GOLD} strokeWidth={1} opacity={state === "mastered" ? 1 : 0.7} />}
              <circle cx={x} cy={y} r={2.2} fill={state === "mastered" ? GOLD : state === "next" ? "#fff" : "rgba(255,255,255,0.4)"} />
            </g>
          );
        })}
        {site.constellation.modules.map((title, index) => (
          <text key={title} x={columns[index]! * width} y={12} textAnchor="middle" fontSize={8} letterSpacing={2} fill={GOLD} opacity={0.9}>
            {title.toUpperCase()}
          </text>
        ))}
      </svg>
    );
  }
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 p-3">
      <dt className="text-[11px] tracking-wide text-white/50 uppercase">{label}</dt>
      <dd className="mt-1 font-medium text-white">{value}</dd>
    </div>
  );
}

function formatMinutes(total: number) {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return hours ? `${hours} h ${minutes} min` : `${minutes} min`;
}
