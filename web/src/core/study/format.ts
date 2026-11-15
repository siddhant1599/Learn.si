import type { CourseStatus, CourseSummary } from "./types";

/** Informational only; nothing in Master mode is time-limited. */
export function formatMinutes(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "";
  const rounded = Math.round(minutes);
  if (rounded < 60) return `≈ ${rounded} min`;
  const hours = Math.floor(rounded / 60), rest = rounded % 60;
  return rest ? `≈ ${hours} h ${rest} min` : `≈ ${hours} h`;
}

/** Fixed copy per failure code; never a backend or provider message. */
const FAILURES: Record<string, string> = {
  provider: "The model could not produce a usable lesson plan.",
  budget: "The plan needed more model calls than allowed.",
  timeout: "Planning took too long.",
  unreadable: "The document has too little readable text to plan.",
  interrupted: "Planning was interrupted by a server restart.",
};

export function failureReason(code?: string | null): string {
  return (code && FAILURES[code]) || "Planning failed.";
}

export const STATUS_LABEL: Record<CourseStatus, string> = {
  generating: "Generating",
  ready: "Ready",
  failed: "Failed",
};

export function completionPercent(course: Pick<CourseSummary, "completed_lessons" | "lesson_count">): number {
  if (!course.lesson_count) return 0;
  return Math.min(100, Math.round((course.completed_lessons / course.lesson_count) * 100));
}

export function courseHref(id: string) {
  return `/workspace/courses/${encodeURIComponent(id)}`;
}

export function lessonHref(courseId: string, lessonId: string) {
  return `${courseHref(courseId)}/lessons/${encodeURIComponent(lessonId)}`;
}

const LESSON_FAILURES: Record<string, string> = {
  provider: "The model could not write this lesson.",
  budget: "Writing the lesson needed more model calls than allowed.",
  timeout: "Writing the lesson took too long.",
  unreadable: "The lesson's sections have no readable text.",
  invalid: "The draft did not fit the lesson format.",
  ungrounded: "The draft's citations could not be verified against the document.",
  interrupted: "Writing was interrupted by a server restart.",
};

export function lessonFailureReason(code?: string | null): string {
  return (code && LESSON_FAILURES[code]) || "The lesson could not be written.";
}

export function quizHref(courseId: string, lessonId: string, attemptId?: string) {
  const base = `${lessonHref(courseId, lessonId)}/quiz`;
  return attemptId ? `${base}?attempt=${encodeURIComponent(attemptId)}` : base;
}

/** Study time as "1 h 12 min"; informational only, never a limit. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0 min";
  if (seconds < 60) return "< 1 min";
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  if (!hours) return `${minutes} min`;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

export function formatRate(rate: number | null | undefined): string {
  return rate === null || rate === undefined ? "—" : `${Math.round(rate * 100)}%`;
}

export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "No activity yet";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
