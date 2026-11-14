/** Product modes. Distinct from ChatDepth, which is a per-turn reasoning preference. */
export type WorkspaceMode = "ask" | "master";

export type ModeDefinition = {
  value: WorkspaceMode;
  label: string;
  /** Approved product copy; render verbatim. */
  tagline: string;
  /** Where entering the mode lands. */
  href: string;
};

export const MODES: readonly ModeDefinition[] = [
  {
    value: "ask",
    label: "Ask",
    tagline: "Get answers. Understand anything.",
    href: "/workspace/chats/new",
  },
  {
    value: "master",
    label: "Master",
    tagline: "Learn deeply. Build mastery.",
    href: "/workspace/courses",
  },
];

/** Only used to highlight the last choice on the chooser; never to skip it. */
export const LAST_MODE_KEY = "study-buddy.last-mode";

export function modeFromPathname(
  pathname: string | null | undefined,
): WorkspaceMode | null {
  if (!pathname) return null;
  if (pathname.startsWith("/workspace/chats")) return "ask";
  if (
    pathname.startsWith("/workspace/courses") ||
    pathname.startsWith("/workspace/progress")
  )
    return "master";
  return null;
}

export function modeHome(mode: WorkspaceMode): string {
  return MODES.find((item) => item.value === mode)!.href;
}

export function readLastMode(storage: Storage): WorkspaceMode | null {
  try {
    const value = storage.getItem(LAST_MODE_KEY);
    return value === "ask" || value === "master" ? value : null;
  } catch {
    return null;
  }
}

export function writeLastMode(storage: Storage, mode: WorkspaceMode) {
  try {
    storage.setItem(LAST_MODE_KEY, mode);
  } catch {
    /* Private windows or blocked storage: the chooser simply has no highlight. */
  }
}
