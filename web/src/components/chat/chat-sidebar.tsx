"use client";

import {
  ChevronsUpDown,
  HouseIcon,
  LibraryIcon,
  MessageSquarePlus,
  MessagesSquare,
  MonitorIcon,
  MoonIcon,
  SettingsIcon,
  SunIcon,
  TrendingUpIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { RecentCourses } from "@/components/study/recent-courses";
import { ModeSwitch } from "@/components/workspace/mode-switch";
import { site } from "@/config/site";
import { useChatStore } from "@/core/chat/store";
import { modeFromPathname } from "@/core/workspace/mode";
import { cn } from "@/lib/utils";

import { DeleteButton } from "./delete-button";
import { DocumentsPanel } from "./documents-panel";
import { WorkspaceSidebarTrigger } from "./workspace-sidebar-trigger";

function SidebarBrand() {
  const { isMobile, open } = useSidebar();
  const pathname = usePathname();
  const mode = modeFromPathname(pathname);
  const expanded = isMobile || open;

  return (
    <>
      <div className="group/workspace-header flex h-12 flex-col justify-center">
        {!expanded ? (
          <div className="flex w-full cursor-pointer items-center justify-center">
            <Link
              href="/workspace"
              aria-label={`${site.name}: choose a mode`}
              className="text-primary block pt-1 font-serif group-hover/workspace-header:hidden"
            >
              {site.shortName}
            </Link>
            <WorkspaceSidebarTrigger className="hidden pl-2 group-hover/workspace-header:block" />
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <Link href="/workspace" className="text-primary ml-2 font-serif">
              {site.name}
            </Link>
            <WorkspaceSidebarTrigger />
          </div>
        )}
      </div>
      <ModeSwitch />
      {mode === "ask" && (
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              isActive={pathname === "/workspace/chats/new"}
              asChild
            >
              <Link className="text-muted-foreground" href="/workspace/chats/new">
                <MessageSquarePlus size={16} />
                <span>New chat</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      )}
    </>
  );
}

const MODE_NAV = {
  ask: [{ href: "/workspace/chats", label: "Chats", icon: MessagesSquare }],
  master: [
    { href: "/workspace/courses", label: "Courses", icon: LibraryIcon },
    { href: "/workspace/progress", label: "Progress", icon: TrendingUpIcon },
  ],
} as const;

function SidebarNav() {
  const pathname = usePathname();
  const mode = modeFromPathname(pathname);
  // The chooser shows only the mode switch; nothing else is "current" there.
  if (!mode) return null;
  return (
    <SidebarGroup className="pt-1">
      <SidebarMenu>
        {MODE_NAV[mode].map((item) => (
          <SidebarMenuItem key={item.href}>
            <SidebarMenuButton
              isActive={pathname === item.href}
              tooltip={item.label}
              asChild
            >
              <Link className="text-muted-foreground" href={item.href}>
                <item.icon />
                <span>{item.label}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
}

function RecentChats() {
  const { threads, deleteChat } = useChatStore();
  const pathname = usePathname();
  const { isMobile, open } = useSidebar();
  if (!(isMobile || open) || threads.length === 0) return null;

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Recent chats</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {threads.map((thread) => (
            <SidebarMenuItem key={thread.id} className="deletable-row flex items-center gap-1 rounded-md pr-1 hover:bg-sidebar-accent/60 focus-within:bg-sidebar-accent/60">
              <SidebarMenuButton
                isActive={pathname === `/workspace/chats/${thread.id}`}
                asChild
              >
                <Link
                  className="text-muted-foreground min-w-0 flex-1"
                  href={`/workspace/chats/${thread.id}`}
                >
                  <span className="truncate">{thread.title}</span>
                </Link>
              </SidebarMenuButton>
              <DeleteButton title={thread.title} description="Delete this chat and its saved messages. Source documents will be kept." onDelete={() => deleteChat(thread.id)} />
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

const THEMES = [
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
  { value: "system", label: "System", icon: MonitorIcon },
];

function SettingsMenu() {
  const { isMobile, open } = useSidebar();
  const { theme, setTheme } = useTheme();
  // Radix ids differ between server and client until hydration has finished.
  const [mounted, setMounted] = useState(false);
  const expanded = isMobile || open;

  useEffect(() => {
    setMounted(true);
  }, []);

  const trigger = expanded ? (
    <div className="text-muted-foreground flex w-full items-center gap-2 text-left text-sm">
      <SettingsIcon className="size-4" />
      <span>Settings and more</span>
      <ChevronsUpDown className="text-muted-foreground ml-auto size-4" />
    </div>
  ) : (
    <div className="flex size-full items-center justify-center">
      <SettingsIcon className="text-muted-foreground size-4" />
    </div>
  );

  return (
    <SidebarMenu className="w-full">
      <SidebarMenuItem>
        {mounted ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <SidebarMenuButton
                aria-label="Settings and more"
                size="lg"
                className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
              >
                {trigger}
              </SidebarMenuButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              className="w-(--radix-dropdown-menu-trigger-width) min-w-56"
              side="top"
              align="start"
              sideOffset={4}
            >
              <DropdownMenuGroup>
                <DropdownMenuLabel className="text-muted-foreground text-xs">
                  Theme
                </DropdownMenuLabel>
                {THEMES.map((item) => (
                  <DropdownMenuItem
                    key={item.value}
                    className={cn(theme === item.value && "bg-accent")}
                    onClick={() => setTheme(item.value)}
                  >
                    <item.icon className="size-4" />
                    {item.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/">
                  <HouseIcon className="size-4" />
                  Home page
                </Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <SidebarMenuButton size="lg">{trigger}</SidebarMenuButton>
        )}
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

export function ChatSidebar() {
  const { isMobile } = useSidebar();
  const mode = modeFromPathname(usePathname());
  return (
    <Sidebar variant="sidebar" collapsible="icon">
      <SidebarHeader className="py-0">
        <SidebarBrand />
      </SidebarHeader>
      <SidebarContent>
        <SidebarNav />
        {/* Sources and chats belong to Ask; Master lists its courses. */}
        {mode === "ask" && <DocumentsPanel />}
        {mode === "ask" && <RecentChats />}
        {mode === "master" && <RecentCourses />}
      </SidebarContent>
      <SidebarFooter>
        <SettingsMenu />
      </SidebarFooter>
      {!isMobile && <SidebarRail />}
    </Sidebar>
  );
}
