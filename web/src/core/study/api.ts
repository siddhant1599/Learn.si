import { parseSSE } from "@/core/chat/adapter";
import { progressStep } from "@/core/chat/progress";
import { mergeStep } from "@/core/chat/reducer";
import type { ChatStep } from "@/core/chat/types";

import type {
  CourseSummary,
  CourseView,
  LessonDetail,
  QuizAttemptView,
  QuizHistoryItem,
} from "./types";

const BASE = "/api/rag";

export class StudyRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}, fallback = "Request failed. Please retry."): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}/${path}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
      ...init,
    });
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw new StudyRequestError("Cannot reach the server. Check the backend connection.", 0);
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new StudyRequestError(typeof body?.detail === "string" ? body.detail : fallback, response.status);
  return body as T;
}

export type CourseDetail = { course: CourseView; steps: ChatStep[] };

/** Live job events; throws when the stream is unavailable. */
async function* streamEvents(path: string, signal: AbortSignal): AsyncGenerator<
  { type: "step"; step: ChatStep } | { type: "status" }
> {
  const response = await fetch(`${BASE}/${path}`, {
    cache: "no-store",
    headers: { Accept: "text/event-stream" },
    signal,
  });
  if (!response.ok || !response.body) throw new StudyRequestError("Progress stream unavailable.", response.status);
  for await (const frame of parseSSE(response.body)) {
    if (frame.event === "progress") {
      const step = progressStep(frame.data);
      if (step) yield { type: "step", step };
    } else if (frame.event === "status") {
      yield { type: "status" };
    }
  }
}

export function stepsFrom(events: unknown, steps: ChatStep[] = []): ChatStep[] {
  if (!Array.isArray(events)) return steps;
  return events.reduce<ChatStep[]>((current, item) => {
    const step = progressStep(item);
    return step ? mergeStep(current, step) : current;
  }, steps);
}

export const studyApi = {
  list: () => request<CourseSummary[]>("courses", {}, "Cannot load courses."),
  async get(id: string, signal?: AbortSignal): Promise<CourseDetail> {
    const { progress, ...course } = await request<CourseView & { progress?: unknown }>(
      `courses/${encodeURIComponent(id)}`, signal ? { signal } : {}, "Cannot load this course.",
    );
    return { course, steps: stepsFrom(progress) };
  },
  create: (documentId: string) =>
    request<CourseSummary>("courses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ document_id: documentId }),
    }, "Course creation failed. Please retry."),
  remove: (id: string) =>
    request<{ status: string; id: string }>(`courses/${encodeURIComponent(id)}`, { method: "DELETE" },
      "Course deletion failed. Please retry."),
};

type FollowOptions<T> = {
  signal: AbortSignal;
  onUpdate: (detail: T) => void;
  pollMs?: number;
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
};

function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
  });
}

/**
 * Follow a background job until it settles: live SSE first, then polling the
 * detail endpoint when the stream errors or ends. Resolves with the final detail.
 */
async function followJob<T extends { steps: ChatStep[] }>(
  eventsPath: string,
  load: (signal: AbortSignal) => Promise<T>,
  running: (detail: T) => boolean,
  detail: T,
  options: FollowOptions<T>,
): Promise<T> {
  const { signal, onUpdate, pollMs = 3000, wait = delay } = options;
  let current = detail;
  const publish = (next: T) => { current = next; onUpdate(next); };
  try {
    for await (const event of streamEvents(eventsPath, signal)) {
      if (event.type === "step") publish({ ...current, steps: mergeStep(current.steps, event.step) });
      else break;
    }
  } catch (error) {
    if (signal.aborted) throw error;
    // Fall through to polling: proxies and flaky networks may drop SSE.
  }
  while (!signal.aborted) {
    const fresh = await load(signal).catch((error) => {
      if (signal.aborted) throw error;
      return null;
    });
    if (fresh) {
      publish({ ...fresh, steps: fresh.steps.reduce(mergeStep, current.steps) });
      if (!running(fresh)) return current;
    }
    await wait(pollMs, signal);
  }
  throw signal.reason;
}

export function followCourse(id: string, detail: CourseDetail, options: FollowOptions<CourseDetail>) {
  return followJob(`courses/${encodeURIComponent(id)}/events`, (signal) => studyApi.get(id, signal),
    (d) => d.course.status === "generating", detail, options);
}

export type LessonState = { lesson: LessonDetail; steps: ChatStep[]; generating: boolean };

export function followLesson(id: string, detail: LessonState, options: FollowOptions<LessonState>) {
  return followJob(`lessons/${encodeURIComponent(id)}/events`, (signal) => lessonApi.get(id, signal),
    (d) => d.generating, detail, options);
}

const json = (body: unknown) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const lessonApi = {
  /** Opening marks the lesson in progress and starts generation when needed. */
  async get(id: string, signal?: AbortSignal): Promise<LessonState> {
    const { generation_progress, ...lesson } = await request<LessonDetail & { generation_progress?: unknown }>(
      `lessons/${encodeURIComponent(id)}`, signal ? { signal } : {}, "Cannot load this lesson.",
    );
    return { lesson, steps: stepsFrom(generation_progress), generating: lesson.content_status === "generating" };
  },
  async regenerate(id: string): Promise<LessonState> {
    const { generation_progress, ...lesson } = await request<LessonDetail & { generation_progress?: unknown }>(
      `lessons/${encodeURIComponent(id)}/regenerate`, { method: "POST" }, "Regeneration failed. Please retry.",
    );
    return { lesson, steps: stepsFrom(generation_progress), generating: lesson.content_status === "generating" };
  },
};

export const quizApi = {
  start: (lessonId: string) =>
    request<QuizAttemptView>(`lessons/${encodeURIComponent(lessonId)}/quiz-attempts`,
      { method: "POST", signal: AbortSignal.timeout(120000) }, "The quiz could not be generated. Please retry."),
  get: (attemptId: string) =>
    request<QuizAttemptView>(`quiz-attempts/${encodeURIComponent(attemptId)}`, {}, "Cannot load this quiz attempt."),
  submit: (attemptId: string, answers: Record<string, string>) =>
    request<QuizAttemptView>(`quiz-attempts/${encodeURIComponent(attemptId)}/submit`, json({ answers }),
      "Submission failed. Your answers are kept; please retry."),
  history: (lessonId: string) =>
    request<QuizHistoryItem[]>(`lessons/${encodeURIComponent(lessonId)}/quiz-attempts`, {}, "Cannot load attempts."),
};
