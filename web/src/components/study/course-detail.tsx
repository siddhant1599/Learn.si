"use client";

import { ArrowLeftIcon, BookOpenIcon, LockIcon } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { MasterEmptyPage } from "@/components/workspace/master-empty";
import { WorkspacePageHeader } from "@/components/workspace/page-header";
import { OutlineSkeleton } from "@/components/workspace/skeletons";
import { completionPercent, formatMinutes, lessonHref } from "@/core/study/format";
import type { CourseView } from "@/core/study/types";
import { useCourse } from "@/core/study/use-course";

import { CourseStatusBadge } from "./course-status";
import { GenerationFailed, GenerationProgress } from "./generation-progress";

const LESSON_STATUS: Record<string, string> = {
  locked: "Locked", available: "Ready to start", in_progress: "In progress", completed: "Completed",
};

/** A compact outline until the full plan page (#28) replaces it. */
function PlanOutline({ course }: { course: CourseView }) {
  const percent = completionPercent(course);
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {course.module_count} modules · {course.lesson_count} lessons
        {formatMinutes(course.estimated_minutes) && ` · ${formatMinutes(course.estimated_minutes)} (estimate only)`}
        {` · ${percent}% complete`}
      </p>
      {course.next_lesson_id && (
        <Button asChild size="sm">
          <Link href={lessonHref(course.id, course.next_lesson_id)}>
            {course.completed_lessons ? "Continue" : "Start the first lesson"}
          </Link>
        </Button>
      )}
      <ol className="space-y-3">
        {course.modules.map((module) => (
          <li key={module.id} className="rounded-xl border p-4">
            <h2 className="text-sm font-medium [overflow-wrap:anywhere]">{module.position}. {module.title}</h2>
            {module.summary && <p className="mt-1 text-xs text-muted-foreground">{module.summary}</p>}
            <ol className="mt-3 space-y-1">
              {module.lessons.map((lesson) => (
                <li key={lesson.id} className="flex min-w-0 items-center gap-2 text-sm">
                  {lesson.status === "locked" && <LockIcon aria-hidden="true" className="size-3 shrink-0 text-muted-foreground" />}
                  {lesson.status === "locked" ? (
                    <span className="min-w-0 text-muted-foreground [overflow-wrap:anywhere]">{lesson.title}</span>
                  ) : (
                    <Link className="min-w-0 underline-offset-2 hover:underline [overflow-wrap:anywhere]" href={lessonHref(course.id, lesson.id)}>{lesson.title}</Link>
                  )}
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">{LESSON_STATUS[lesson.status]}</span>
                </li>
              ))}
            </ol>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function CourseDetail({ courseId }: { courseId: string }) {
  const { course, steps, loading, error, notFound, retry, retrying, reload } = useCourse(courseId);
  if (loading) return <OutlineSkeleton title="Course" />;
  if (notFound)
    return (
      <MasterEmptyPage
        title="Course"
        heading="This course is not available"
        description="It may have been deleted, or its source document was removed."
        icon={<BookOpenIcon className="size-8" />}
        action={{ href: "/workspace/courses", label: "Back to courses" }}
      />
    );
  return (
    <div className="flex size-full min-w-0 flex-col">
      <WorkspacePageHeader title={course?.title ?? "Course"}>
        {course && <CourseStatusBadge status={course.status} />}
      </WorkspacePageHeader>
      <div className="mx-auto w-full max-w-3xl min-w-0 space-y-6 overflow-y-auto px-4 py-6">
        <Link href="/workspace/courses" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeftIcon aria-hidden="true" className="size-3" />
          Back to courses
        </Link>
        {error && (
          <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive">
            <span>{error}</span>
            <Button size="sm" variant="outline" onClick={() => void reload()}>Retry</Button>
          </div>
        )}
        {course?.status === "generating" && <GenerationProgress steps={steps} />}
        {course?.status === "failed" && (
          <GenerationFailed code={course.failure_code} steps={steps} retrying={retrying} onRetry={() => void retry()} />
        )}
        {course?.status === "ready" && <PlanOutline course={course} />}
      </div>
    </div>
  );
}
