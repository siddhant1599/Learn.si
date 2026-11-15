"use client";

import Link from "next/link";

import { DeleteButton } from "@/components/chat/delete-button";
import { Progress } from "@/components/ui/progress";
import {
  completionPercent,
  courseHref,
  failureReason,
  formatMinutes,
  lessonHref,
} from "@/core/study/format";
import type { CourseSummary } from "@/core/study/types";

import { CourseStatusBadge } from "./course-status";

export const DELETE_COURSE_COPY =
  "Delete this course, its lesson progress, quiz attempts and tutor chats. The source document is kept and stays available in Ask mode.";

function target(course: CourseSummary) {
  if (course.status === "ready" && course.next_lesson_id)
    return { href: lessonHref(course.id, course.next_lesson_id), action: "Continue" };
  return { href: courseHref(course.id), action: course.status === "ready" ? "Open plan" : "View progress" };
}

/** One tab stop for the card (a stretched link) plus its delete control. */
export function CourseCard({ course, onDelete }: { course: CourseSummary; onDelete: () => Promise<void> }) {
  const { href, action } = target(course);
  const percent = completionPercent(course);
  const estimate = formatMinutes(course.estimated_minutes);
  return (
    <article className="deletable-row relative flex min-w-0 flex-col gap-3 rounded-xl border p-5 transition-colors focus-within:bg-accent/40 hover:bg-accent/40">
      <div className="flex items-start justify-between gap-2">
        <h2 className="min-w-0 text-sm font-medium [overflow-wrap:anywhere]">
          <Link href={href} className="after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none">
            {course.title}
            <span className="sr-only">: {action}</span>
          </Link>
        </h2>
        <div className="relative z-10 -mt-1 -mr-2">
          <DeleteButton title={course.title} description={DELETE_COURSE_COPY} onDelete={onDelete} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <CourseStatusBadge status={course.status} />
        {course.status === "ready" && (
          <>
            <span>{course.module_count} {course.module_count === 1 ? "module" : "modules"}</span>
            <span aria-hidden="true">·</span>
            <span>{course.lesson_count} {course.lesson_count === 1 ? "lesson" : "lessons"}</span>
            {estimate && <><span aria-hidden="true">·</span><span>{estimate}</span></>}
          </>
        )}
      </div>
      {course.status === "failed" && (
        <p className="text-xs text-destructive">{failureReason(course.failure_code)}</p>
      )}
      {course.status === "generating" && (
        <p className="text-xs text-muted-foreground">Preparing the lesson plan…</p>
      )}
      {course.status === "ready" && (
        <div className="space-y-1">
          <Progress value={percent} aria-label={`${course.title} progress`} aria-valuetext={`${percent}% complete`} />
          <p className="text-xs text-muted-foreground">
            {course.completed_lessons} of {course.lesson_count} lessons complete · {percent}%
          </p>
        </div>
      )}
      <span aria-hidden="true" className="mt-auto text-xs font-medium text-primary">{action} →</span>
    </article>
  );
}
