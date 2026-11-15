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
