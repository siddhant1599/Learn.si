/** Master-mode course contracts mirrored from app/study/models.py. */
export type CourseStatus = "generating" | "ready" | "failed";
export type LessonStatus = "locked" | "available" | "in_progress" | "completed";
export type ContentStatus = "pending" | "generating" | "ready" | "failed";

export type CourseSummary = {
  id: string;
  document_id: string;
  title: string;
  status: CourseStatus;
  failure_code?: string | null;
  estimated_minutes: number;
  module_count: number;
  lesson_count: number;
  completed_lessons: number;
  next_lesson_id?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type LessonOutline = {
  id: string;
  module_id: string;
  position: number;
  title: string;
  objective: string;
  estimated_minutes: number;
  content_status: ContentStatus;
  status: LessonStatus;
};

export type ModuleView = {
  id: string;
  position: number;
  title: string;
  summary: string;
  estimated_minutes: number;
  lessons: LessonOutline[];
};

export type CourseView = CourseSummary & {
  generation?: string | null;
  modules: ModuleView[];
};
