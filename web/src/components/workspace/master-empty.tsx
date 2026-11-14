"use client";

import Link from "next/link";

import { ConversationEmptyState } from "@/components/ai-elements/conversation";
import { Button } from "@/components/ui/button";

import { WorkspacePageHeader } from "./page-header";

/** Shared shell for Master-mode pages until their data arrives (#27–#31). */
export function MasterEmptyPage({
  title,
  heading,
  description,
  icon,
  action,
}: {
  title: string;
  heading: string;
  description: string;
  icon: React.ReactNode;
  action?: { href: string; label: string };
}) {
  return (
    <div className="flex size-full flex-col">
      <WorkspacePageHeader title={title} />
      <ConversationEmptyState>
        <div className="text-muted-foreground">{icon}</div>
        <div className="max-w-md space-y-1">
          <h2 className="text-sm font-medium">{heading}</h2>
          <p className="text-muted-foreground text-sm">{description}</p>
        </div>
        {action && (
          <Button asChild className="mt-2" size="sm" variant="outline">
            <Link href={action.href}>{action.label}</Link>
          </Button>
        )}
      </ConversationEmptyState>
    </div>
  );
}
