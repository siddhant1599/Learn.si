"use client";

import dynamic from "next/dynamic";
import { useRef } from "react";

import { useRenderActivity } from "@/core/dom/render-activity";
import { cn } from "@/lib/utils";

const Galaxy = dynamic(() => import("@/components/ui/galaxy"), { ssr: false });

/** The starfield behind the landing hero and the mode chooser: WebGL only while on screen. */
export function GalaxyBackdrop({ className }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const render = useRenderActivity(ref);
  return (
    <div
      ref={ref}
      aria-hidden="true"
      className={cn(
        "absolute inset-0 z-0 bg-[radial-gradient(ellipse_at_center,#252019_0%,#0a0a0a_70%)]",
        className,
      )}
    >
      {render && (
        <Galaxy
          mouseRepulsion={false}
          starSpeed={0.2}
          density={0.6}
          glowIntensity={0.35}
          twinkleIntensity={0.3}
          speed={0.5}
        />
      )}
    </div>
  );
}
