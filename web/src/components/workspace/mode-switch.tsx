"use client";

import { usePathname, useRouter } from "next/navigation";

import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  MODES,
  modeFromPathname,
  writeLastMode,
} from "@/core/workspace/mode";
import { cn } from "@/lib/utils";

import { MODE_ICONS } from "./mode-icons";

/**
 * Ask | Master switch under the sidebar brand. Neutral (nothing pressed) on the
 * chooser; a segmented control when expanded, two icon buttons in the rail.
 */
export function ModeSwitch() {
  const pathname = usePathname();
  const router = useRouter();
  const { isMobile, open, setOpenMobile } = useSidebar();
  const current = modeFromPathname(pathname);
  const expanded = isMobile || open;

  const select = (value: (typeof MODES)[number]) => {
    writeLastMode(localStorage, value.value);
    if (isMobile) setOpenMobile(false);
    router.push(value.href);
  };

  if (!expanded) {
    return (
      <SidebarMenu aria-label="Workspace mode" className="gap-1">
        {MODES.map((mode) => {
          const Icon = MODE_ICONS[mode.value];
          const pressed = current === mode.value;
          return (
            <SidebarMenuItem key={mode.value}>
              <SidebarMenuButton
                type="button"
                aria-pressed={pressed}
                aria-label={`${mode.label} mode`}
                tooltip={`${mode.label} — ${mode.tagline}`}
                isActive={pressed}
                onClick={() => select(mode)}
              >
                <Icon />
              </SidebarMenuButton>
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
    );
  }

  return (
    <div
      role="group"
      aria-label="Workspace mode"
      className="bg-sidebar-accent/60 mx-2 mb-1 grid grid-cols-2 gap-1 rounded-lg p-1"
    >
      {MODES.map((mode) => {
        const Icon = MODE_ICONS[mode.value];
        const pressed = current === mode.value;
        return (
          <button
            key={mode.value}
            type="button"
            aria-pressed={pressed}
            title={mode.tagline}
            onClick={() => select(mode)}
            className={cn(
              "ring-sidebar-ring flex h-8 items-center justify-center gap-1.5 rounded-md text-xs font-medium transition-colors outline-hidden focus-visible:ring-2",
              pressed
                ? "bg-background text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon aria-hidden="true" className="size-3.5" />
            {mode.label}
          </button>
        );
      })}
    </div>
  );
}
