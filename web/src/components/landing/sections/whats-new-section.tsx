"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, type RefObject } from "react";

import { StaticBentoGrid, type BentoCardData } from "@/components/ui/bento-grid";
import { site } from "@/config/site";
import {
  usePrefersReducedMotion,
  useRenderActivity,
} from "@/core/dom/render-activity";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

import { Section } from "../section";

// gsap-driven enhancement; the static grid below carries the same markup and copy.
const MagicBento = dynamic(() => import("@/components/ui/magic-bento"), {
  ssr: false,
});

const COLOR = "#0a0a0a";
const features: BentoCardData[] = site.whatsNew.features.map((feature) => ({
  ...feature,
  color: COLOR,
}));

export function WhatsNewSection({ className }: { className?: string }) {
  const bentoContainerRef = useRef<HTMLDivElement>(null);
  const inView = useRenderActivity(bentoContainerRef, false, false);
  const reducedMotion = usePrefersReducedMotion();
  const isMobile = useIsMobile();
  // Server HTML and every non-pointer context get the plain grid; desktop pointer
  // devices swap in the animated version once the section scrolls into view.
  const enhance = inView && !reducedMotion && !isMobile;
  useBentoSpotlight(bentoContainerRef, enhance);

  return (
    <Section
      className={cn("", className)}
      title={site.whatsNew.title}
    >
      <div
        ref={bentoContainerRef}
        className="flex min-h-96 w-full items-center justify-center"
      >
        {enhance ? (
          <MagicBento data={features} enableSpotlight={false} />
        ) : (
          <StaticBentoGrid data={features} />
        )}
      </div>
    </Section>
  );
}

function useBentoSpotlight(
  containerRef: RefObject<HTMLDivElement | null>,
  active: boolean,
) {
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !active) return;

    let pendingPointerFrame: number | undefined;
    let pointer: { x: number; y: number } | undefined;

    const clearGlow = () => {
      container
        .querySelectorAll<HTMLElement>(".magic-bento-card")
        .forEach((card) => card.style.setProperty("--glow-intensity", "0"));
    };
    const renderPointer = () => {
      pendingPointerFrame = undefined;
      if (!pointer) return;
      const { x, y } = pointer;
      pointer = undefined;
      const radius = 300;
      const proximity = radius * 0.5;
      const fadeDistance = radius * 0.75;
      container
        .querySelectorAll<HTMLElement>(".magic-bento-card")
        .forEach((card) => {
          const rect = card.getBoundingClientRect();
          const centerX = rect.left + rect.width / 2;
          const centerY = rect.top + rect.height / 2;
          const distance =
            Math.hypot(x - centerX, y - centerY) -
            Math.max(rect.width, rect.height) / 2;
          const effectiveDistance = Math.max(0, distance);
          const intensity =
            effectiveDistance <= proximity
              ? 1
              : effectiveDistance <= fadeDistance
                ? (fadeDistance - effectiveDistance) /
                  (fadeDistance - proximity)
                : 0;
          card.style.setProperty(
            "--glow-x",
            `${((x - rect.left) / rect.width) * 100}%`,
          );
          card.style.setProperty(
            "--glow-y",
            `${((y - rect.top) / rect.height) * 100}%`,
          );
          card.style.setProperty("--glow-intensity", intensity.toString());
          card.style.setProperty("--glow-radius", `${radius}px`);
        });
    };
    const handlePointerMove = (event: PointerEvent) => {
      pointer = { x: event.clientX, y: event.clientY };
      if (pendingPointerFrame !== undefined) return;
      pendingPointerFrame = requestAnimationFrame(renderPointer);
    };

    container.addEventListener("pointermove", handlePointerMove, {
      passive: true,
    });
    container.addEventListener("pointerleave", clearGlow);
    return () => {
      if (pendingPointerFrame !== undefined) {
        cancelAnimationFrame(pendingPointerFrame);
      }
      container.removeEventListener("pointermove", handlePointerMove);
      container.removeEventListener("pointerleave", clearGlow);
      clearGlow();
    };
  }, [active, containerRef]);
}
