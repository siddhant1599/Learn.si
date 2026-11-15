"use client";

import { RefreshCwIcon } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDuration, formatRate, formatWhen, lessonHref } from "@/core/study/format";
import type { CourseView, LessonStatus, Mastery } from "@/core/study/types";

import { MASTERY, MasteryBadge, useCourseProgress } from "./course-plan";
import { BloomBars, MasteryBar, MASTERY_ORDER } from "./progress-charts";

const STATUS: Record<LessonStatus, string> = {
  locked: "Locked", available: "Available", in_progress: "In progress", completed: "Completed",
};

export const MASTERY_DEFINITIONS: Record<Mastery, string> = {
  not_started: "Never opened.",
  learning: "Opened or quiz attempted, not passed yet.",
  developing: "Quiz passed after a retake.",
  proficient: "Quiz passed on the first attempt.",
  mastered: "First attempt 3/3 and a correct Your turn answer within two tries.",
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-lg font-medium tabular-nums">{value}</dd>
    </div>
  );
}

function TableFrame({ children }: { children: React.ReactNode }) {
  // Tables scroll inside their own frame; the page never scrolls sideways. `relative`
  // makes the frame the containing block for absolutely positioned screen-reader text
  // in cells, so it is clipped with the table instead of widening the page.
  return <div className="relative max-w-full overflow-x-auto rounded-xl border">{children}</div>;
}

export function CourseProgressView({ course }: { course: CourseView }) {
  const { progress, error, reload } = useCourseProgress(course.id);
  if (!progress)
    return error ? (
      <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive">
        <span>{error}</span><Button size="sm" variant="outline" onClick={reload}>Retry</Button>
      </div>
    ) : (
      <div className="space-y-3" aria-busy="true"><Skeleton className="h-24 w-full" /><Skeleton className="h-40 w-full" /></div>
    );
  const titles = new Map(course.modules.map((m) => [m.id, m.title]));
  const studyByModule = new Map<string, number>();
  for (const row of progress.lessons) studyByModule.set(row.module_id, (studyByModule.get(row.module_id) ?? 0) + row.study_seconds);
  const quiz = progress.quiz;
  return (
    <div className="space-y-6">
      <section aria-labelledby="overall-heading" className="space-y-4 rounded-xl border p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 id="overall-heading" className="text-sm font-medium">Overall</h2>
          <Button size="sm" variant="ghost" className="gap-1" onClick={reload}>
            <RefreshCwIcon aria-hidden="true" className="size-3" /> Refresh
          </Button>
        </div>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Complete" value={`${progress.percent}%`} />
          <Stat label="Lessons" value={`${progress.completed_lessons} of ${progress.lesson_count}`} />
          <Stat label="Study time" value={formatDuration(progress.study_seconds)} />
          <Stat label="Estimated time left" value={progress.estimated_minutes_remaining ? `≈ ${progress.estimated_minutes_remaining} min` : "—"} />
        </dl>
        <p className="text-xs text-muted-foreground">Estimates are informational; nothing is timed. Last activity: {formatWhen(progress.last_activity)}.</p>
        <MasteryBar distribution={progress.mastery_distribution} />
      </section>

      <section aria-labelledby="quiz-heading" className="space-y-4 rounded-xl border p-5">
        <h2 id="quiz-heading" className="text-sm font-medium">Quiz performance</h2>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Attempts" value={String(quiz.attempts)} />
          <Stat label="Pass rate" value={formatRate(quiz.pass_rate)} />
          <Stat label="First-try pass rate" value={formatRate(quiz.first_try_pass_rate)} />
          <Stat label="Average score" value={quiz.average_score === null ? "—" : `${quiz.average_score}/3`} />
        </dl>
        <div className="space-y-2">
          <h3 className="text-xs font-medium text-muted-foreground">Correct answers by question type</h3>
          <BloomBars bloom={quiz.bloom} />
        </div>
      </section>

      <section aria-labelledby="modules-heading" className="space-y-3">
        <h2 id="modules-heading" className="text-sm font-medium">Modules</h2>
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">What do the mastery levels mean?</summary>
          <dl className="mt-2 space-y-1">
            {MASTERY_ORDER.map((level) => (
              <div key={level} className="flex flex-wrap gap-1">
                <dt className="font-medium text-foreground">{MASTERY[level].label}:</dt>
                <dd>{MASTERY_DEFINITIONS[level]}</dd>
              </div>
            ))}
            <div className="flex flex-wrap gap-1">
              <dt className="font-medium text-foreground">Module:</dt>
              <dd>the lowest level of its lessons once all are completed; before that, Developing if any lesson is completed.</dd>
            </div>
          </dl>
        </details>
        <TableFrame>
          <table className="w-full min-w-[34rem] text-sm">
            <caption className="sr-only">Mastery, completion, quiz pass rate and study time per module</caption>
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">Module</th>
                <th scope="col" className="px-3 py-2 font-medium">Mastery</th>
                <th scope="col" className="px-3 py-2 font-medium">Lessons</th>
                <th scope="col" className="px-3 py-2 font-medium">Pass rate</th>
                <th scope="col" className="px-3 py-2 font-medium">Study time</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {progress.modules.map((module) => (
                <tr key={module.id}>
                  <th scope="row" className="px-3 py-2 text-left font-normal [overflow-wrap:anywhere]">{module.position}. {titles.get(module.id) ?? module.title}</th>
                  <td className="px-3 py-2"><MasteryBadge level={module.mastery} /></td>
                  <td className="px-3 py-2 tabular-nums">{module.completed_lessons}/{module.lesson_count}</td>
                  <td className="px-3 py-2 tabular-nums">{formatRate(module.quiz.pass_rate)}</td>
                  <td className="px-3 py-2 tabular-nums">{formatDuration(studyByModule.get(module.id) ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableFrame>
      </section>

      <section aria-labelledby="lessons-heading" className="space-y-3">
        <h2 id="lessons-heading" className="text-sm font-medium">Lessons</h2>
        <TableFrame>
          <table className="w-full min-w-[40rem] text-sm">
            <caption className="sr-only">Status, quiz attempts, first-try pass, best score, mastery and study time per lesson</caption>
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">Lesson</th>
                <th scope="col" className="px-3 py-2 font-medium">Status</th>
                <th scope="col" className="px-3 py-2 font-medium">Attempts</th>
                <th scope="col" className="px-3 py-2 font-medium">First try</th>
                <th scope="col" className="px-3 py-2 font-medium">Best</th>
                <th scope="col" className="px-3 py-2 font-medium">Mastery</th>
                <th scope="col" className="px-3 py-2 font-medium">Study time</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {progress.lessons.map((row) => (
                <tr key={row.id} data-lesson={row.id}>
                  <th scope="row" className="px-3 py-2 text-left font-normal [overflow-wrap:anywhere]">
                    {row.status === "locked" ? `${row.position}. ${row.title}` : (
                      <Link className="hover:underline" href={lessonHref(course.id, row.id)}>{row.position}. {row.title}</Link>
                    )}
                  </th>
                  <td className="px-3 py-2">{STATUS[row.status]}</td>
                  <td className="px-3 py-2 tabular-nums">{row.quiz_attempts}</td>
                  <td className="px-3 py-2">{row.first_try_pass === null ? "—" : row.first_try_pass ? "Passed" : "Not passed"}</td>
                  <td className="px-3 py-2 tabular-nums">{row.best_score === null ? "—" : `${row.best_score}/3`}</td>
                  <td className="px-3 py-2"><MasteryBadge level={row.mastery} /></td>
                  <td className="px-3 py-2 tabular-nums">{formatDuration(row.study_seconds)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableFrame>
      </section>
    </div>
  );
}
