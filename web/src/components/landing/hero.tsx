"use client";

import { ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { GalaxyBackdrop } from "@/components/landing/galaxy-backdrop";
import { AuroraText } from "@/components/ui/aurora-text";
import { Button, buttonVariants } from "@/components/ui/button";
import { FlickeringGrid } from "@/components/ui/flickering-grid";
import { site } from "@/config/site";
import { usePrefersReducedMotion } from "@/core/dom/render-activity";
import { cn } from "@/lib/utils";

export function Hero({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "relative flex size-full flex-col items-center justify-center",
        className,
      )}
    >
      <GalaxyBackdrop />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(10,10,10,0.7),transparent_75%)]" />
      <FlickeringGrid
        className="absolute inset-0 z-0 mask-size-[140.4vw] mask-center mask-no-repeat md:mask-size-[100.8vh]"
        style={{ maskImage: `url(${site.logoMaskUrl})` }}
        squareSize={4}
        gridGap={4}
        color={"white"}
        maxOpacity={0.4}
        flickerChance={0.25}
      />
      <div className="container-md relative z-10 mx-auto flex min-h-[100svh] flex-col items-center justify-center px-4 pt-20 pb-24">
        <h1 className="text-center text-5xl leading-tight font-bold break-words md:text-6xl">
          {site.hero.title}
        </h1>
        {/* flex-wrap: on narrow screens the suffix drops under the phrase instead of splitting it. */}
        <div className="mt-3 flex w-full max-w-full min-w-0 flex-wrap items-center justify-center gap-x-2 text-center text-2xl font-semibold md:text-4xl">
          <HeroWordRotate words={site.hero.rotatingWords} />
          <span className="whitespace-nowrap">{site.hero.rotatingSuffix}</span>
        </div>
        {/* Styled like frontend-sample's hero button, but a plain label: no link, not focusable. */}
        <div
          data-beta-badge
          className={cn(buttonVariants({ size: "lg" }), "pointer-events-none mt-6 h-11 cursor-default px-5 select-none")}
        >
          <span className="text-md">{site.hero.betaLabel}</span>
        </div>
        <p className="text-muted-foreground mt-8 max-w-4xl text-center text-base leading-7 text-shadow-sm sm:text-xl md:text-2xl">
          {site.hero.description}
        </p>
        <Link href={site.hero.ctaHref}>
          <Button className="mt-8 h-11 px-5" size="lg">
            <span className="text-md">{site.hero.ctaLabel}</span>
            <ChevronRightIcon className="size-4" />
          </Button>
        </Link>
      </div>
      {/* Pinned to the bottom of the hero, below the book mark (the mask is centered and sized to the viewport). */}
      <a
        href="#examples"
        className="absolute bottom-6 left-1/2 z-10 -translate-x-1/2 text-xs tracking-widest whitespace-nowrap text-white/60 uppercase hover:text-white"
      >
        Explore the workspace ↓
      </a>
    </div>
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
