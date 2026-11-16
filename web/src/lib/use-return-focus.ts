"use client";

import { useEffect, useRef } from "react";

/**
 * Restore focus to whatever opened a controlled dialog. Radix returns focus only to
 * its own DialogTrigger; dialogs opened from a plain button or a menu item would
 * otherwise drop focus to <body> on close.
 */
export function useReturnFocus(open: boolean) {
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (open && document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
      opener.current = document.activeElement;
    }
  }, [open]);
  return (event: Event) => {
    const target = opener.current;
    if (target && target.isConnected) {
      event.preventDefault();
      target.focus();
    }
  };
}
