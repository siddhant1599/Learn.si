"use client";

import { MessageSquareOffIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

import { PromptInputProvider } from "@/components/ai-elements/prompt-input";
import { ConversationEmptyState } from "@/components/ai-elements/conversation";
import { Button } from "@/components/ui/button";
import { site } from "@/config/site";
import { useChatStore } from "@/core/chat/store";
import type { AssistantMessage } from "@/core/chat/types";
import { cn } from "@/lib/utils";

import { Composer } from "./composer";
import { FlipDisplay } from "./flip-display";
import { MessageList } from "./message-list";
import { SourceTree } from "./source-tree";
import { TodoList } from "./todo-list";
import { Welcome } from "./welcome";
import { WorkspaceSidebarTrigger } from "./workspace-sidebar-trigger";

const NEW_THREAD_ID = "new";

export function ChatPage() {
  // Not useParams: it ignores the history.replaceState call in handleSubmit.
  const routeThreadId = usePathname().split("/").pop() ?? NEW_THREAD_ID;
  const {
    ready, deletions, documents, chatsError, loadThread,
    webAvailable,
    threads,
    selectedIds,
    settings,
    setSettings,
    isStreaming,
    send,
    stop,
  } = useChatStore();

  const isNewThread = routeThreadId === NEW_THREAD_ID;
  const thread = threads.find((item) => item.id === routeThreadId);
  // A listed chat's messages come from the server when it is opened.
  const unloaded = !!thread && thread.loaded === false;
  useEffect(() => {
    if (thread && thread.loaded === false && !thread.loadError) void loadThread(thread.id);
  }, [thread, loadThread]);
  const isWelcomeMode = isNewThread || (!unloaded && !thread?.messages.length);
  const streaming = isStreaming(routeThreadId);
  const title = thread?.title;
  const missingSource = thread?.documentIds?.some(id => deletions.some(d => d.kind === "document" && d.id === id));

  useEffect(() => {
    document.title = `${title ?? "New chat"} - ${site.name}`;
  }, [title]);

  const handleSubmit = (text: string, files: File[]) => {
    // A UUID: the server stores the chat under this same id, so its address works everywhere.
    const threadId = isNewThread ? crypto.randomUUID() : routeThreadId;
    send({ threadId, text, files });
    if (isNewThread) {
      // Keeps this page mounted so the composer can animate down from welcome.
      history.replaceState(null, "", `/workspace/chats/${threadId}`);
    }
  };

  if (ready && !isNewThread && !thread) {
    return (
      <div className="flex size-full flex-col">
        <ChatHeader isWelcomeMode={false} />
        <ConversationEmptyState>
          <MessageSquareOffIcon className="text-muted-foreground size-8" />
          <p className="text-sm font-medium">Chat not found</p>
          <p className="text-muted-foreground text-sm">
            {chatsError || "This chat was deleted or does not exist. Start a new one to continue."}
          </p>
          <Button asChild className="mt-2" size="sm" variant="outline">
            <Link href={`/workspace/chats/${NEW_THREAD_ID}`}>New chat</Link>
          </Button>
        </ConversationEmptyState>
      </div>
    );
  }

  if (unloaded) {
    return (
      <div className="flex size-full flex-col">
        <ChatHeader isWelcomeMode={false} threadId={routeThreadId} title={thread.title} />
        <ConversationEmptyState>
          {thread.loadError ? (
            <>
              <p className="text-sm font-medium">This chat could not be loaded</p>
              <p className="text-muted-foreground text-sm">{thread.loadError}</p>
              <Button className="mt-2" size="sm" variant="outline" onClick={() => void loadThread(thread.id)}>
                Try again
              </Button>
            </>
          ) : (
            <p role="status" className="text-muted-foreground text-sm">Loading chat…</p>
          )}
        </ConversationEmptyState>
      </div>
    );
  }

  const composerArea = (
    <>
      {thread && thread.todos.length > 0 && !isWelcomeMode && (
        <TodoList className="bg-background/5" todos={thread.todos} />
      )}
      {missingSource && <p role="alert" className="p-3 text-sm">A source was deleted. Saved answers may still contain its information. <Link className="underline" href="/workspace/chats/new">Start a new chat with available sources.</Link></p>}
      <Composer
        className={cn(
          "bg-background/5 w-full",
          isWelcomeMode && "-translate-y-2 sm:-translate-y-4",
        )}
        disabled={
          !ready || missingSource || !(thread?.documentIds?.length || selectedIds.length)
        }
        isStreaming={streaming}
        isWelcomeMode={isWelcomeMode}
        settings={settings}
        webAvailable={webAvailable}
        extraHeader={isWelcomeMode && <Welcome depth={settings.depth} />}
        onSettingsChange={setSettings}
        onStop={() => stop(routeThreadId)}
        onSubmit={handleSubmit}
      />
    </>
  );

  if (!isWelcomeMode && thread) {
    // The landing demo's stage with real data: the chat's documents on the left, lighting
    // up as the latest answer searches, checks and cites them; the agent chat on the right.
    const answers = thread.messages.filter((m): m is AssistantMessage => m.role === "assistant");
    const deletedIds = deletions.filter((d) => d.kind === "document").map((d) => d.id);
    const sources = (thread.documentIds ?? []).map(
      (id) => documents.find((doc) => doc.id === id) ?? { id, title: "Unavailable source" },
    );
    return (
      <PromptInputProvider>
        <div className="relative flex size-full min-h-0 flex-col">
          <ChatHeader isWelcomeMode={false} threadId={routeThreadId} title={title} />
          <div className="flex min-h-0 grow gap-6 px-2 pt-14 pb-3 sm:px-4 lg:gap-8 lg:px-6">
            <SourceTree
              className="hidden w-64 shrink-0 overflow-y-auto pt-3 lg:flex xl:w-72"
              documents={sources}
              messages={answers}
              deletedIds={deletedIds}
            />
            <section
              aria-label="Conversation"
              className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-50/60 dark:border-zinc-800 dark:bg-zinc-900/50"
            >
              <div className="flex shrink-0 items-center gap-2 border-b border-zinc-200 p-4 dark:border-zinc-800">
                <span
                  aria-hidden="true"
                  className={cn("size-3 rounded-full bg-green-500", streaming && "animate-pulse motion-reduce:animate-none")}
                />
                <span className="text-sm text-muted-foreground">{site.name} Agent · Ask mode</span>
              </div>
              <div className="flex min-h-0 flex-1">
                <MessageList className="size-full" messages={thread.messages} />
              </div>
              {/* pb-8: the composer's disclaimer hangs below it and must stay inside the panel. */}
              <div className="relative z-30 shrink-0 border-t border-zinc-200 px-3 pt-3 pb-8 dark:border-zinc-800">
                {composerArea}
              </div>
            </section>
          </div>
        </div>
      </PromptInputProvider>
    );
  }

  return (
    <PromptInputProvider>
      <div className="relative flex size-full min-h-0 flex-col justify-between">
        <ChatHeader
          isWelcomeMode={isWelcomeMode}
          threadId={routeThreadId}
          title={title}
        />
        <section className="flex min-h-0 max-w-full grow flex-col" aria-label="Conversation">
          <div className="flex min-h-0 flex-1 justify-center">
            {!isWelcomeMode && thread && (
              <MessageList
                className="size-full pt-10"
                messages={thread.messages}
              />
            )}
          </div>
          <div
            className={cn(
              "right-0 bottom-0 left-0 z-30 flex justify-center px-3 sm:px-4",
              isWelcomeMode ? "absolute" : "relative shrink-0 pb-4",
            )}
          >
            <div
              className={cn(
                "relative w-full",
                isWelcomeMode &&
                  "-translate-y-[calc(50vh-48px)] sm:-translate-y-[calc(50vh-96px)]",
                isWelcomeMode
                  ? "max-w-(--container-width-sm)"
                  : "max-w-(--container-width-md)",
              )}
            >
              {composerArea}
            </div>
          </div>
        </section>
      </div>
    </PromptInputProvider>
  );
}

function ChatHeader({
  isWelcomeMode,
  threadId,
  title,
}: {
  isWelcomeMode: boolean;
  threadId?: string;
  title?: string;
}) {
  return (
    <header
      className={cn(
        "absolute top-0 right-0 left-0 flex h-12 shrink-0 items-center gap-2 px-2 sm:px-4",
        isWelcomeMode
          ? "bg-background/0 z-40 backdrop-blur-none"
          : "bg-background/80 z-30 shadow-xs backdrop-blur",
      )}
    >
      <WorkspaceSidebarTrigger className="md:hidden" />
      {/* Every workspace page has one level-1 heading; the visible title animates. */}
      <h1 className="sr-only">{title ?? "New chat"}</h1>
      <div className="flex min-w-0 flex-1 items-center gap-2 text-sm font-medium">
        {title && threadId && (
          <FlipDisplay
            uniqueKey={threadId}
            className="min-w-0 [&>div]:truncate"
          >
            {title}
          </FlipDisplay>
        )}
      </div>
    </header>
  );
}
