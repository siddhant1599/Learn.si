"use client";

import { DeleteButton } from "@/components/chat/delete-button";
import Link from "next/link";

import { WorkspaceSidebarTrigger } from "@/components/chat/workspace-sidebar-trigger";
import { useChatStore } from "@/core/chat/store";

export default function ChatsPage() {
  const { threads, deleteChat } = useChatStore();

  return (
    <div className="flex size-full flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 px-2 text-sm font-medium sm:px-4">
        <WorkspaceSidebarTrigger className="md:hidden" />
        Chats
      </header>
      <main className="mx-auto w-full max-w-(--container-width-md) flex-1 overflow-y-auto px-4 py-4">
        <ul className="flex flex-col gap-2">
          {threads.map((thread) => (
            <li key={thread.id} className="deletable-row flex items-center gap-2 rounded-lg border pr-2 transition-colors hover:bg-accent/50 focus-within:bg-accent/50">
              <Link
                className="block min-w-0 flex-1 rounded-lg px-4 py-3 text-sm transition-colors"
                href={`/workspace/chats/${thread.id}`}
              >
                <span className="block truncate font-medium">
                  {thread.title}
                </span>
                <span className="text-muted-foreground text-xs">
                  {thread.messages.length} messages
                </span>
              </Link>
              <DeleteButton title={thread.title} description="Delete this chat and saved messages. Source documents will be kept." onDelete={() => deleteChat(thread.id)} />
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
