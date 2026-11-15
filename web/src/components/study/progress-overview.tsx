"use client";

import { CheckIcon, RefreshCwIcon, TrendingUpIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { ConversationEmptyState } from "@/components/ai-elements/conversation";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { WorkspacePageHeader } from "@/components/workspace/page-header";
import { CourseGridSkeleton } from "@/components/workspace/skeletons";
import { studyApi } from "@/core/study/api";
import { courseHref, formatDuration, formatWhen, lessonHref } from "@/core/study/format";
import type { ProgressOverview as Overview } from "@/core/study/types";

import { MasteryBar } from "./progress-charts";

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0 rounded-xl border p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-medium tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Overview data, refetched on focus and after quiz results (store refresh). */
export function useOverview() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    try {
      const overview = await studyApi.overview();
      if (!overview?.totals || !Array.isArray(overview.courses)) throw new Error("Cannot load progress.");
      setData(overview);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cannot load progress.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
    const refresh = () => void load();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [load]);
  return { data, error, loading, reload: load };
}

export function ProgressOverview() {
  const { data, error, loading, reload } = useOverview();
  if (loading && !data) return <CourseGridSkeleton title="Progress" />;
  return (
    <div className="flex size-full min-w-0 flex-col">
      <WorkspacePageHeader title="Progress">
        <Button size="sm" variant="ghost" className="ml-auto gap-1" onClick={() => void reload()}>
          <RefreshCwIcon aria-hidden="true" className="size-3" /> Refresh
        </Button>
      </WorkspacePageHeader>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {error && (
          <div role="alert" className="mx-auto flex max-w-5xl flex-wrap items-center gap-2 px-4 pt-2 text-sm text-destructive">
            <span>{error}</span>
            <Button size="sm" variant="outline" onClick={() => void reload()}>Retry</Button>
          </div>
        )}
        {data && data.totals.courses === 0 ? (
          <ConversationEmptyState>
            <div className="text-muted-foreground"><TrendingUpIcon className="size-8" /></div>
            <div className="max-w-md space-y-1">
              <h2 className="text-sm font-medium">No progress yet</h2>
              <p className="text-sm text-muted-foreground">
                Create a course in Master mode. Lessons completed, quiz performance, topic mastery and study time will show here. Nothing is timed.
              </p>
            </div>
            <Button asChild size="sm" variant="outline" className="mt-2"><Link href="/workspace/courses">Go to courses</Link></Button>
          </ConversationEmptyState>
        ) : data && (
          <div className="mx-auto w-full max-w-5xl min-w-0 space-y-6 px-4 py-6">
            <section aria-label="Totals" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Tile label="Courses" value={String(data.totals.courses)} />
              <Tile label="Lessons completed" value={`${data.totals.lessons_completed}`} hint={`of ${data.totals.lessons_total}`} />
              <Tile label="Quizzes passed" value={String(data.totals.quizzes_passed)} hint={`of ${data.totals.quiz_attempts} attempts`} />
              <Tile label="Study time" value={formatDuration(data.totals.study_seconds)} hint="Counted while a lesson is open" />
            </section>
            <section aria-labelledby="courses-heading" className="space-y-3">
              <h2 id="courses-heading" className="text-sm font-medium">Courses</h2>
              <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {data.courses.map((course) => (
                  <li key={course.course_id} className="min-w-0 space-y-3 rounded-xl border p-5" data-course={course.course_id}>
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="min-w-0 text-sm font-medium [overflow-wrap:anywhere]">
                        <Link href={`${courseHref(course.course_id)}?tab=progress`} className="hover:underline">{course.title}</Link>
                      </h3>
                      <span className="shrink-0 text-sm tabular-nums">{course.percent}%</span>
                    </div>
                    <Progress value={course.percent} aria-label={`${course.title} progress`} aria-valuetext={`${course.percent}% complete`} />
                    <p className="text-xs text-muted-foreground">
                      {course.completed_lessons} of {course.lesson_count} lessons · {formatDuration(course.study_seconds)} studied · {formatWhen(course.last_activity)}
                    </p>
                    <MasteryBar distribution={course.mastery_distribution} compact />
                    {course.next_lesson_id && (
                      <Button asChild size="sm" variant="outline">
                        <Link href={lessonHref(course.course_id, course.next_lesson_id)}>Continue</Link>
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
            <section aria-labelledby="recent-heading" className="space-y-3">
              <h2 id="recent-heading" className="text-sm font-medium">Recent activity</h2>
              {data.recent.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing yet. Complete a lesson or take a quiz.</p>
              ) : (
                <ul className="divide-y rounded-xl border">
                  {data.recent.map((item, index) => (
                    <li key={`${item.kind}-${item.lesson_id}-${index}`} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm">
                      {item.kind === "quiz" ? (
                        item.passed
                          ? <CheckIcon aria-hidden="true" className="size-4 text-emerald-600 dark:text-emerald-400" />
                          : <XIcon aria-hidden="true" className="size-4 text-muted-foreground" />
                      ) : <CheckIcon aria-hidden="true" className="size-4 text-emerald-600 dark:text-emerald-400" />}
                      <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                        {item.kind === "quiz"
                          ? `Quiz ${item.passed ? "passed" : "not passed"} ${item.score}/3 · ${item.title}`
                          : `Lesson completed · ${item.title}`}
                      </span>
                      <span className="text-xs text-muted-foreground">{formatWhen(item.at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
