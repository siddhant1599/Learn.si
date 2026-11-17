import type { CourseStatus, CourseSummary } from "./types";

/** Only IDs, titles, statuses and counts are cached; never lesson text or provider details. */
export const COURSES_KEY = "learn-si.courses";
/** Key used before the Learn.si rename; read once and moved to COURSES_KEY. */
export const LEGACY_COURSES_KEY = "study-buddy.courses";
const MAX_CACHED = 50;

/** Move a value saved under the pre-rename key to the new key, once. */
function migrateKey(storage: Storage, from: string, to: string) {
  const old = storage.getItem(from);
  if (old === null) return;
  if (storage.getItem(to) === null) storage.setItem(to, old);
  storage.removeItem(from);
}
const STATUSES = new Set<CourseStatus>(["generating", "ready", "failed"]);
const COUNTS = ["estimated_minutes", "module_count", "lesson_count", "completed_lessons"] as const;

export function sanitizeCourse(value: unknown): CourseSummary | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== "string" || typeof v.document_id !== "string" || typeof v.title !== "string") return null;
  if (!STATUSES.has(v.status as CourseStatus)) return null;
  const course: CourseSummary = {
    id: v.id,
    document_id: v.document_id,
    title: v.title.slice(0, 200),
    status: v.status as CourseStatus,
    failure_code: typeof v.failure_code === "string" ? v.failure_code.slice(0, 40) : null,
    next_lesson_id: typeof v.next_lesson_id === "string" ? v.next_lesson_id : null,
    estimated_minutes: 0, module_count: 0, lesson_count: 0, completed_lessons: 0,
  };
  for (const key of COUNTS) {
    const n = v[key];
    course[key] = typeof n === "number" && Number.isSafeInteger(n) && n >= 0 ? n : 0;
  }
  return course;
}

export function readCourses(storage: Storage): CourseSummary[] {
  try {
    migrateKey(storage, LEGACY_COURSES_KEY, COURSES_KEY);
    const parsed: unknown = JSON.parse(storage.getItem(COURSES_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.map(sanitizeCourse).filter((c): c is CourseSummary => c !== null).slice(0, MAX_CACHED);
  } catch {
    return [];
  }
}

export function writeCourses(storage: Storage, courses: CourseSummary[]) {
  try {
    storage.setItem(COURSES_KEY, JSON.stringify(
      courses.slice(0, MAX_CACHED).map(sanitizeCourse).filter(Boolean),
    ));
  } catch {
    /* Blocked or full storage: the library still works in memory. */
  }
}
