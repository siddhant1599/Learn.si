"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { completionPercent, courseHref, STATUS_LABEL } from "@/core/study/format";
import { useStudyStore } from "@/core/study/store";

const LIMIT = 8;

export function RecentCourses() {
  const { courses } = useStudyStore();
  const pathname = usePathname();
  const { isMobile, open } = useSidebar();
  if (!(isMobile || open) || courses.length === 0) return null;
  return (
    <SidebarGroup>
      <SidebarGroupLabel>Recent courses</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {courses.slice(0, LIMIT).map((course) => {
            const href = courseHref(course.id);
            const detail = course.status === "ready" ? `${completionPercent(course)}%` : STATUS_LABEL[course.status];
            return (
              <SidebarMenuItem key={course.id}>
                <SidebarMenuButton isActive={pathname.startsWith(href)} asChild>
                  <Link className="text-muted-foreground min-w-0" href={href}>
                    <span className="min-w-0 flex-1 truncate">{course.title}</span>
                    <span className="shrink-0 text-xs tabular-nums">{detail}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
