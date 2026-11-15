"use client";

import { useEffect } from "react";

import { WorkspaceSidebarTrigger } from "@/components/chat/workspace-sidebar-trigger";
import { site } from "@/config/site";
import { cn } from "@/lib/utils";

/** Browser tab title in the same shape ChatPage uses. */
export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = `${title} - ${site.name}`;
  }, [title]);
}

/** The compact top bar shared by non-chat workspace pages (matches ChatsPage). */
export function WorkspacePageHeader({
  title,
  heading = true,
  className,
  children,
}: {
  title: string;
  /** False for loading skeletons: the page, not its fallback, owns the h1. */
  heading?: boolean;
  className?: string;
  children?: React.ReactNode;
}) {
  useDocumentTitle(title);
  const Title = heading ? "h1" : "p";
  return (
    <header
      className={cn(
        "flex h-12 shrink-0 items-center gap-2 px-2 text-sm font-medium sm:px-4",
        className,
      )}
    >
      <WorkspaceSidebarTrigger className="md:hidden" />
      <Title className="min-w-0 truncate text-sm font-medium">{title}</Title>
      {children}
    </header>
  );
}
