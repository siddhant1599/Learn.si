"use client";

import { ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { GalaxyBackdrop } from "@/components/landing/galaxy-backdrop";
import { AuroraText } from "@/components/ui/aurora-text";
import { Button } from "@/components/ui/button";
import { FlickeringGrid } from "@/components/ui/flickering-grid";
import { site } from "@/config/site";
import { usePrefersReducedMotion } from "@/core/dom/render-activity";
import { cn } from "@/lib/utils";

import { ConstellationScene, type ConstellationHandle } from "./constellation-scene";

/**
 * Scroll stage: 180svh tall with a sticky viewport. The first 80svh of scrolling
 * drives --hero-progress (mask and page fade) and the constellation. Reduced
 * motion shows the finished constellation without a stage.
 */
export function Hero({ className }: { className?: string }) {
  const reduced = usePrefersReducedMotion();
  const section = useRef<HTMLElement>(null);
  const scene = useRef<ConstellationHandle>(null);

  useEffect(() => {
    const apply = (p: number) => {
      section.current?.style.setProperty("--hero-progress", String(p));
      scene.current?.update(p);
    };
    if (reduced) {
      apply(1);
      return;
    }
    let frame: number | undefined;
    const read = () => {
      frame = undefined;
      const el = section.current;
      if (!el) return;
      // No layout yet (offsetHeight 0) is the start state; a stage that cannot scroll is finished.
      const total = el.offsetHeight - window.innerHeight;
      const p = el.offsetHeight === 0
        ? 0
        : total > 0 ? Math.min(1, Math.max(0, -el.getBoundingClientRect().top / total)) : 1;
      apply(p);
    };
    const schedule = () => {
      if (frame === undefined) frame = requestAnimationFrame(read);
    };
    read();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [reduced]);

  return (
    <section
      ref={section}
      data-hero-stage
      aria-label="Introduction"
      className={cn("relative", reduced ? "h-svh" : "h-[180svh]", className)}
      style={{ "--hero-progress": reduced ? 1 : 0 } as React.CSSProperties}
    >
      <div className="sticky top-0 h-svh overflow-hidden">
        <GalaxyBackdrop />
        <FlickeringGrid
          className="absolute inset-0 z-0 mask-size-[140.4vw] mask-center mask-no-repeat md:mask-size-[100.8vh]"
          style={{
            maskImage: `url(${site.logoMaskUrl})`,
            opacity: "calc(1 - var(--hero-progress, 0))",
          }}
          squareSize={4}
          gridGap={4}
          color={"white"}
          maxOpacity={0.3}
          flickerChance={0.25}
        />
        <ConstellationScene ref={scene} className="absolute inset-0 z-[5]" />
        <div className="container-md relative z-10 mx-auto flex flex-col items-center px-4 pt-[14svh] pb-8 text-center sm:pt-[16svh]">
          <h1 className="text-5xl leading-tight font-bold break-words text-shadow-sm md:text-6xl">
            {site.hero.title}
          </h1>
          <div className="mt-3 flex w-full max-w-full min-w-0 items-center justify-center gap-x-2 text-2xl font-semibold md:text-4xl">
            <HeroWordRotate words={site.hero.rotatingWords} />
            <span className="whitespace-nowrap">{site.hero.rotatingSuffix}</span>
          </div>
          <p className="text-muted-foreground mt-6 max-w-3xl text-base leading-7 text-shadow-sm sm:text-lg md:text-xl">
            {site.hero.description}
          </p>
          <Link href={site.hero.ctaHref}>
            <Button className="mt-7 h-11 px-5" size="lg">
              <span className="text-md">{site.hero.ctaLabel}</span>
              <ChevronRightIcon className="size-4" />
            </Button>
          </Link>
          <p className="sr-only">{site.hero.constellation.caption}</p>
        </div>
        {!reduced && (
          <div
            aria-hidden="true"
            className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 text-[11px] tracking-widest text-white/45 uppercase transition-opacity"
            style={{ opacity: "calc(1 - var(--hero-progress, 0) * 4)" }}
          >
            Scroll
          </div>
        )}
      </div>
    </section>
  );
}

function HeroWordRotate({
  words,
  duration = 2200,
}: {
  words: string[];
  duration?: number;
}) {
  const [index, setIndex] = useState(0);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    if (reduced) return;
    const interval = setInterval(() => {
      setIndex((prevIndex) => (prevIndex + 1) % words.length);
    }, duration);

    return () => clearInterval(interval);
  }, [words, duration, reduced]);

  return (
    <div className="relative max-w-full min-w-0 overflow-hidden py-2">
      {/* Remounting on index restarts the CSS enter animation; no exit animation needed. */}
      <div
        key={index}
        className={cn("max-w-full", !reduced && "animate-word-in")}
      >
        <AuroraText
          className="max-w-full [overflow-wrap:anywhere] whitespace-normal"
          speed={3}
          colors={["#efefbb", "#e9c665", "#e3a812"]}
        >
          {words[index]}
        </AuroraText>
      </div>
    </div>
  );
}
