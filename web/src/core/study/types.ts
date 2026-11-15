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

/** Client view of lesson content (#23). Server-only answers are never sent. */
export type InsightKind = "why_it_matters" | "misconception" | "trade_off";
export type YourTurnKind = "code_gap" | "apply" | "fill_blank";

export type LessonContent = {
  objective: string;
  explanation: string;
  real_world_example: string;
  diagram: { kind: "mermaid"; source: string; caption: string } | null;
  code_example: {
    language: string;
    code: string;
    explanation: string;
    todo: { marker: string; instruction: string } | null;
  } | null;
  insights: { kind: InsightKind; text: string }[];
  your_turn: { kind: YourTurnKind; prompt: string };
  key_terms: { term: string; definition: string }[];
  citations: import("@/core/chat/types").DocumentCitation[];
  coverage_note: string | null;
  warnings: string[];
};

export type LessonDetail = {
  id: string;
  course_id: string;
  module_id: string;
  document_id: string;
  position: number;
  title: string;
  objective: string;
  estimated_minutes: number;
  content_status: ContentStatus;
  content_failure_code: string | null;
  content: LessonContent | null;
  regenerations_left: number;
  progress: { status: LessonStatus };
};

export type QuizOption = { id: string; text: string };
export type QuizQuestion = { id: string; stem: string; options: QuizOption[]; bloom_level: string };

export type QuizResult = {
  id: string;
  stem: string;
  options: QuizOption[];
  chosen: string | null;
  correct: boolean;
  correct_option_id: string;
  explanation_for_chosen: string | null;
  explanation_for_correct: string | null;
  citation: import("@/core/chat/types").DocumentCitation | null;
};

export type QuizAttemptHead = {
  attempt_id: string;
  lesson_id: string;
  attempt_number: number;
  status?: "open" | "submitted" | "abandoned";
};

export type QuizAttemptView = QuizAttemptHead & {
  questions?: QuizQuestion[];
  score?: number;
  passed?: boolean;
  questions_with_results?: QuizResult[];
  lesson_status?: LessonStatus;
  unlocked_lesson_id?: string | null;
};

export type QuizHistoryItem = {
  id: string;
  attempt_number: number;
  status: "open" | "submitted" | "abandoned";
  score: number | null;
  passed: boolean | null;
  created_at: string;
  submitted_at: string | null;
};
