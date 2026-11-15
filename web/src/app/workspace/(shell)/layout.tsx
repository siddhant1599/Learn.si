import "katex/dist/katex.min.css";
import "streamdown/styles.css";

import { Toaster } from "sonner";

import { ChatSidebar } from "@/components/chat/chat-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { ChatStoreProvider } from "@/core/chat/store";
import { StudyStoreProvider } from "@/core/study/store";

export default function WorkspaceLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <ChatStoreProvider>
      <StudyStoreProvider>
        <SidebarProvider className="h-screen">
          <ChatSidebar />
          <SidebarInset className="min-w-0">{children}</SidebarInset>
        </SidebarProvider>
        <Toaster position="top-center" />
      </StudyStoreProvider>
    </ChatStoreProvider>
  );
}
