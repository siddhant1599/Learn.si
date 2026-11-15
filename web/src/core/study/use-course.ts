"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { ChatStep } from "@/core/chat/types";

import { followCourse, StudyRequestError, studyApi, type CourseDetail } from "./api";
import { useStudyStore } from "./store";
import type { CourseView } from "./types";

type CourseState = {
  course: CourseView | null;
  steps: ChatStep[];
  loading: boolean;
  error: string;
  notFound: boolean;
};

/**
 * One course's detail with live generation progress. A refresh mid-generation
 * resumes from the server snapshot, then follows SSE (polling as a fallback).
 */
export function useCourse(courseId: string) {
  const { upsert, courses } = useStudyStore();
  const [state, setState] = useState<CourseState>({
    course: null, steps: [], loading: true, error: "", notFound: false,
  });
  const controller = useRef<AbortController | null>(null);
  const [retrying, setRetrying] = useState(false);

  const publish = useCallback((detail: CourseDetail) => {
    setState({ course: detail.course, steps: detail.steps, loading: false, error: "", notFound: false });
    const { modules: _modules, generation: _generation, ...summary } = detail.course;
    upsert(summary);
  }, [upsert]);

  const watch = useCallback(async () => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    try {
      const detail = await studyApi.get(courseId, current.signal);
      publish(detail);
      if (detail.course.status === "generating")
        await followCourse(courseId, detail, { signal: current.signal, onUpdate: publish });
    } catch (error) {
      if (current.signal.aborted) return;
      const notFound = error instanceof StudyRequestError && error.status === 404;
      setState((s) => ({
        ...s, loading: false, notFound,
        error: notFound ? "" : error instanceof Error ? error.message : "Cannot load this course.",
      }));
    }
  }, [courseId, publish]);

  useEffect(() => {
    void watch();
    return () => controller.current?.abort();
  }, [watch]);

  // A tombstone (course or source document deleted elsewhere) removes it from the store.
  const known = courses.some((c) => c.id === courseId);
  const wasKnown = useRef(false);
  useEffect(() => {
    if (known) wasKnown.current = true;
    else if (wasKnown.current) {
      controller.current?.abort();
      setState({ course: null, steps: [], loading: false, error: "", notFound: true });
    }
  }, [known]);

  const retry = useCallback(async () => {
    const course = state.course;
    if (!course || retrying) return;
    setRetrying(true);
    try {
      // POST /courses restarts a failed course with a fresh generation.
      await studyApi.create(course.document_id);
      setState((s) => ({ ...s, steps: [] }));
      void watch();
    } catch (error) {
      setState((s) => ({ ...s, error: error instanceof Error ? error.message : "Retry failed." }));
    } finally {
      setRetrying(false);
    }
  }, [state.course, retrying, watch]);

  return { ...state, retrying, retry, reload: watch };
}
