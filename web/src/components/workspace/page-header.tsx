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
  className,
  children,
}: {
  title: string;
  className?: string;
  children?: React.ReactNode;
}) {
  useDocumentTitle(title);
  return (
    <header
      className={cn(
        "flex h-12 shrink-0 items-center gap-2 px-2 text-sm font-medium sm:px-4",
        className,
      )}
    >
      <WorkspaceSidebarTrigger className="md:hidden" />
      <h1 className="min-w-0 truncate text-sm font-medium">{title}</h1>
      {children}
    </header>
  );
}
