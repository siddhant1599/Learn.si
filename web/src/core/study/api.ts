import { parseSSE } from "@/core/chat/adapter";
import { progressStep } from "@/core/chat/progress";
import { mergeStep } from "@/core/chat/reducer";
import type { ChatStep } from "@/core/chat/types";

import type { CourseSummary, CourseView } from "./types";

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
  /** Live generation events; throws when the stream is unavailable. */
  async *events(id: string, signal: AbortSignal): AsyncGenerator<
    { type: "step"; step: ChatStep } | { type: "status"; status: string }
  > {
    const response = await fetch(`${BASE}/courses/${encodeURIComponent(id)}/events`, {
      cache: "no-store",
      headers: { Accept: "text/event-stream" },
      signal,
    });
    if (!response.ok || !response.body) throw new StudyRequestError("Progress stream unavailable.", response.status);
    for await (const frame of parseSSE(response.body)) {
      if (frame.event === "progress") {
        const step = progressStep(frame.data);
        if (step) yield { type: "step", step };
      } else if (frame.event === "status" && typeof frame.data?.status === "string") {
        yield { type: "status", status: frame.data.status };
      }
    }
  },
};

type FollowOptions = {
  signal: AbortSignal;
  onUpdate: (detail: CourseDetail) => void;
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
 * Follow a generating course until it settles: live SSE first, then polling
 * GET /courses/{id} when the stream errors or ends early. Resolves with the final detail.
 */
export async function followCourse(id: string, detail: CourseDetail, options: FollowOptions): Promise<CourseDetail> {
  const { signal, onUpdate, pollMs = 3000, wait = delay } = options;
  let current = detail;
  const publish = (next: CourseDetail) => { current = next; onUpdate(next); };
  try {
    for await (const event of studyApi.events(id, signal)) {
      if (event.type === "step") publish({ ...current, steps: mergeStep(current.steps, event.step) });
      else break;
    }
  } catch (error) {
    if (signal.aborted) throw error;
    // Fall through to polling: proxies and flaky networks may drop SSE.
  }
  while (!signal.aborted) {
    const fresh = await studyApi.get(id, signal).catch((error) => {
      if (signal.aborted) throw error;
      return null;
    });
    if (fresh) {
      publish({ course: fresh.course, steps: fresh.steps.reduce(mergeStep, current.steps) });
      if (fresh.course.status !== "generating") return current;
    }
    await wait(pollMs, signal);
  }
  throw signal.reason;
}
