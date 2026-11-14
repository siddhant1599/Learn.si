"use client";

import { ArrowRightIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { GalaxyBackdrop } from "@/components/landing/galaxy-backdrop";
import { site } from "@/config/site";
import {
  MODES,
  readLastMode,
  writeLastMode,
  type WorkspaceMode,
} from "@/core/workspace/mode";
import { cn } from "@/lib/utils";

import { MODE_ICONS } from "./mode-icons";
import { useDocumentTitle } from "./page-header";

/**
 * The workspace entry at /workspace: standalone (no sidebar), never auto-redirects.
 * Shares the landing starfield but not its logo mask.
 */
export function ModeChooser() {
  useDocumentTitle("Choose a mode");
  const [lastMode, setLastMode] = useState<WorkspaceMode | null>(null);
  useEffect(() => {
    setLastMode(readLastMode(localStorage));
  }, []);

  return (
    <div className="relative flex min-h-screen flex-col overflow-x-clip bg-[#0a0a0a] text-white">
      <GalaxyBackdrop />
      <header className="relative z-10 mx-auto flex w-full max-w-5xl items-center px-4 py-4 sm:px-6">
        <Link href="/" className="font-serif text-xl">
          {site.name}
        </Link>
      </header>
      <main className="relative z-10 mx-auto flex w-full max-w-4xl flex-1 flex-col justify-center px-4 pb-16 sm:px-8">
        <div className="mb-8 text-center sm:mb-10">
          <h1 className="font-serif text-3xl leading-tight text-shadow-sm sm:text-4xl">
            How do you want to learn today?
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-sm text-white/70 sm:text-base">
            Pick a mode to open the workspace. You can switch any time from the
            sidebar.
          </p>
        </div>
        <ul className="grid list-none gap-4 p-0 sm:grid-cols-2 sm:gap-6">
          {MODES.map((mode) => {
            const Icon = MODE_ICONS[mode.value];
            const isLast = lastMode === mode.value;
            return (
              <li key={mode.value} className="min-w-0">
                <Link
                  href={mode.href}
                  data-mode={mode.value}
                  aria-label={`${mode.label}: ${mode.tagline}`}
                  onClick={() => writeLastMode(localStorage, mode.value)}
                  className={cn(
                    "group flex h-full min-h-56 flex-col justify-between rounded-2xl border border-white/15 bg-white/[0.03] p-6 shadow-2xl backdrop-blur-sm transition-[border-color,background-color,transform] outline-none sm:p-8",
                    "hover:border-white/40 hover:bg-white/[0.06] motion-safe:hover:-translate-y-0.5",
                    "focus-visible:border-white/60 focus-visible:ring-[3px] focus-visible:ring-white/40",
                    isLast && "border-white/40",
                  )}
                >
                  <div className="flex items-start justify-between gap-4">
                    <Icon
                      aria-hidden="true"
                      className="size-7 text-white/70 transition-colors group-hover:text-white"
                    />
                    {isLast && (
                      <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-medium text-white">
                        Last used
                      </span>
                    )}
                  </div>
                  <div className="mt-8">
                    <span className="block font-serif text-3xl leading-none">
                      {mode.label}
                    </span>
                    <span className="mt-2 block text-base text-white/70">
                      {mode.tagline}
                    </span>
                  </div>
                  <span className="mt-8 flex items-center gap-1 text-sm font-medium">
                    Open {mode.label}
                    <ArrowRightIcon
                      aria-hidden="true"
                      className="size-4 transition-transform motion-safe:group-hover:translate-x-0.5"
                    />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </main>
    </div>
  );
}
