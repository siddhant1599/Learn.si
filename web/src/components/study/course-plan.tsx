"use client";

import {
  AwardIcon,
  CheckIcon,
  ChevronDownIcon,
  CircleDashedIcon,
  CircleDotIcon,
  LockIcon,
  PlayIcon,
  SproutIcon,
  StarIcon,
  TrendingUpIcon,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { DeleteButton } from "@/components/chat/delete-button";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";
import { useChatStore } from "@/core/chat/store";
import { studyApi } from "@/core/study/api";
import { formatMinutes, lessonHref } from "@/core/study/format";
import { useStudyStore } from "@/core/study/store";
import type { CourseProgress, CourseView, LessonOutline, LessonProgressRow, Mastery } from "@/core/study/types";
import { cn } from "@/lib/utils";

import { DELETE_COURSE_COPY } from "./course-card";

export const MASTERY: Record<Mastery, { label: string; icon: LucideIcon }> = {
  not_started: { label: "Not started", icon: CircleDashedIcon },
  learning: { label: "Learning", icon: SproutIcon },
  developing: { label: "Developing", icon: TrendingUpIcon },
  proficient: { label: "Proficient", icon: StarIcon },
  mastered: { label: "Mastered", icon: AwardIcon },
};

const STATUS: Record<LessonOutline["status"], { label: string; icon: LucideIcon }> = {
  locked: { label: "Locked", icon: LockIcon },
  available: { label: "Available", icon: PlayIcon },
  in_progress: { label: "In progress", icon: CircleDotIcon },
  completed: { label: "Completed", icon: CheckIcon },
};

export function MasteryBadge({ level }: { level: Mastery }) {
  const meta = MASTERY[level];
  return (
    <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs text-muted-foreground" data-mastery={level}>
      <meta.icon aria-hidden="true" className="size-3" />
      <span><span className="sr-only">Mastery: </span>{meta.label}</span>
    </span>
  );
}

function quizChip(row?: LessonProgressRow) {
  if (!row || !row.quiz_attempts) return null;
  if (row.passed) return `Passed ${row.best_score}/3`;
  return "Retake needed";
}

/** Plan progress with a refetch on focus, so quiz results show without a reload. */
function useCourseProgress(courseId: string) {
  const [progress, setProgress] = useState<CourseProgress | null>(null);
  const load = useCallback(() => {
    studyApi.progress(courseId).then(setProgress).catch(() => {});
  }, [courseId]);
  useEffect(() => {
    load();
    window.addEventListener("focus", load);
    return () => window.removeEventListener("focus", load);
  }, [load]);
  return progress;
}

function LessonRow({
  courseId, lesson, row, highlight,
}: { courseId: string; lesson: LessonOutline; row?: LessonProgressRow; highlight: boolean }) {
  const status = STATUS[lesson.status];
  const locked = lesson.status === "locked";
  const chip = quizChip(row);
  const estimate = formatMinutes(lesson.estimated_minutes);
  const body = (
    <>
      <span aria-hidden="true" className="w-6 shrink-0 pt-0.5 text-right text-xs tabular-nums text-muted-foreground">{lesson.position}</span>
      <span className="min-w-0 flex-1">
        <span className={cn("block text-sm [overflow-wrap:anywhere]", locked ? "text-muted-foreground" : "font-medium")}>
          {lesson.title}
        </span>
        {lesson.objective && <span className="mt-0.5 block text-xs text-muted-foreground [overflow-wrap:anywhere]">{lesson.objective}</span>}
        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1" data-status={lesson.status}>
            <status.icon aria-hidden="true" className={cn("size-3", lesson.status === "completed" && "text-emerald-600 dark:text-emerald-400")} />
            {status.label}
          </span>
          {estimate && <span>{estimate}</span>}
          {chip && <span className={cn("rounded-full border px-2", row?.passed ? "border-emerald-600/40" : "border-amber-500/40")}>{chip}</span>}
        </span>
      </span>
    </>
  );
  const classes = cn(
    "flex min-w-0 gap-3 rounded-lg px-2 py-2.5",
    highlight && "bg-primary/10 ring-1 ring-primary/40 motion-safe:transition-colors motion-safe:duration-1000",
  );
  return (
    <li data-lesson={lesson.id} data-unlocked={highlight || undefined}>
      {locked ? (
        <div className={cn(classes, "cursor-not-allowed")} aria-disabled="true" title="Pass the previous quiz to unlock">
          {body}
          <span className="sr-only">. Pass the previous quiz to unlock.</span>
        </div>
      ) : (
        <Link href={lessonHref(courseId, lesson.id)} className={cn(classes, "hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none")}>
          {body}
        </Link>
      )}
    </li>
  );
}

export function CoursePlan({ course }: { course: CourseView }) {
  const router = useRouter();
  const { documents } = useChatStore();
  const { remove, recentlyUnlocked, clearUnlocked } = useStudyStore();
  const progress = useCourseProgress(course.id);
  const rows = new Map((progress?.lessons ?? []).map((row) => [row.id, row]));
  const moduleProgress = new Map((progress?.modules ?? []).map((m) => [m.id, m]));
  const next = progress?.next_lesson_id ?? course.next_lesson_id ?? null;
  const nextModule = course.modules.find((m) => m.lessons.some((l) => l.id === next))?.id ?? course.modules[0]?.id;
  const [open, setOpen] = useState<Set<string>>(() => new Set(nextModule ? [nextModule] : []));
  const completed = progress?.completed_lessons ?? course.completed_lessons;
  const total = progress?.lesson_count ?? course.lesson_count;
  const percent = progress?.percent ?? (total ? Math.round((completed * 100) / total) : 0);
  const source = documents.find((d) => d.id === course.document_id);
  const remaining = progress ? formatMinutes(progress.estimated_minutes_remaining) : "";

  // A highlight shows once per unlock, then fades on the next visit.
  useEffect(() => {
    const shown = course.modules.flatMap((m) => m.lessons).filter((l) => recentlyUnlocked.has(l.id));
    if (!shown.length) return;
    const timer = setTimeout(() => shown.forEach((l) => clearUnlocked(l.id)), 4000);
    return () => clearTimeout(timer);
  }, [course.modules, recentlyUnlocked, clearUnlocked]);

  async function deleteCourse() {
    await remove(course.id);
    toast.success("Course deleted. The source document was kept.");
    router.push("/workspace/courses");
  }

  return (
    <div className="space-y-5">
      <section aria-label="Course progress" className="sticky top-0 z-10 -mx-4 space-y-3 border-b bg-background/95 px-4 pb-4 backdrop-blur sm:static sm:mx-0 sm:rounded-xl sm:border sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-base font-medium [overflow-wrap:anywhere]">{course.title}</h2>
            {source && (
              <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                Source: {source.title}{source.edition ? ` · ${source.edition}` : ""}
              </p>
            )}
          </div>
          <DeleteButton title={course.title} description={DELETE_COURSE_COPY} onDelete={deleteCourse} />
        </div>
        <Progress value={percent} aria-label="Course progress" aria-valuetext={`${percent}% complete`} />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{percent}%</span> · {completed} of {total} lessons completed
            <span className="hidden sm:inline">
              {formatMinutes(course.estimated_minutes) && ` · ${formatMinutes(course.estimated_minutes)} of lessons`}
              {remaining && completed > 0 && ` (${remaining} left)`}
            </span>
          </p>
          {next && (
            <Button asChild size="sm">
              <Link href={lessonHref(course.id, next)}>{completed ? "Continue" : "Start the first lesson"}</Link>
            </Button>
          )}
        </div>
      </section>
      <ol className="space-y-3" aria-label="Modules">
        {course.modules.map((module) => {
          const stats = moduleProgress.get(module.id);
          const done = module.lessons.filter((l) => l.status === "completed").length;
          const isOpen = open.has(module.id);
          return (
            <li key={module.id}>
              <Collapsible
                open={isOpen}
                onOpenChange={(value) => setOpen((current) => {
                  const updated = new Set(current);
                  if (value) updated.add(module.id); else updated.delete(module.id);
                  return updated;
                })}
                className="rounded-xl border"
              >
                <h3>
                <CollapsibleTrigger
                  aria-label={`${module.position}. ${module.title}, ${done} of ${module.lessons.length} lessons completed${stats ? `, mastery: ${MASTERY[stats.mastery].label}` : ""}`}
                  className="flex w-full min-w-0 items-start gap-3 rounded-xl p-4 text-left hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                  <ChevronDownIcon aria-hidden="true" className={cn("mt-0.5 size-4 shrink-0 transition-transform motion-reduce:transition-none", !isOpen && "-rotate-90")} />
                  <span className="min-w-0 flex-1 space-y-1">
                    <span className="block text-sm font-medium [overflow-wrap:anywhere]">{module.position}. {module.title}</span>
                    {module.summary && <span className="block text-xs text-muted-foreground [overflow-wrap:anywhere]">{module.summary}</span>}
                    <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>{done} of {module.lessons.length} lessons</span>
                      {formatMinutes(module.estimated_minutes) && <span>{formatMinutes(module.estimated_minutes)}</span>}
                      {stats && <MasteryBadge level={stats.mastery} />}
                    </span>
                  </span>
                </CollapsibleTrigger>
                </h3>
                <CollapsibleContent>
                  <ol className="space-y-0.5 border-t px-2 py-2" aria-label={`Lessons in ${module.title}`}>
                    {module.lessons.map((lesson) => (
                      <LessonRow key={lesson.id} courseId={course.id} lesson={lesson} row={rows.get(lesson.id)}
                        highlight={recentlyUnlocked.has(lesson.id)} />
                    ))}
                  </ol>
                </CollapsibleContent>
              </Collapsible>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
