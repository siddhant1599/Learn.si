"use client";

import { useEffect } from "react";

import { sendStudyTime } from "./api";

export const HEARTBEAT_MS = 30_000;
const MAX_BEAT_SECONDS = 60;

/**
 * Passive study time: credits only while the lesson is mounted, the tab is
 * visible and the window focused. Each beat sends at most 60 s of real elapsed
 * time; the server clamps again. Never a countdown, never a limit.
 */
export function useStudyTime(lessonId: string, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const active = () => document.visibilityState === "visible" && document.hasFocus();
    let since: number | null = active() ? Date.now() : null;

    const flush = () => {
      if (since === null) return;
      const now = Date.now();
      const seconds = Math.min(MAX_BEAT_SECONDS, Math.floor((now - since) / 1000));
      since = now;
      if (seconds >= 1) void sendStudyTime(lessonId, seconds);
    };
    const update = () => {
      if (active()) {
        if (since === null) since = Date.now();
      } else {
        flush();
        since = null;
      }
    };
    const timer = setInterval(() => { if (active()) flush(); else update(); }, HEARTBEAT_MS);
    document.addEventListener("visibilitychange", update);
    window.addEventListener("focus", update);
    window.addEventListener("blur", update);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("focus", update);
      window.removeEventListener("blur", update);
      flush();
    };
  }, [lessonId, enabled]);
}
