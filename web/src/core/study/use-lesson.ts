"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { followLesson, lessonApi, StudyRequestError, type LessonState } from "./api";

type State = {
  data: LessonState | null;
  loading: boolean;
  error: string;
  notFound: boolean;
};

/** A lesson with live content generation; refresh resumes from the server snapshot. */
export function useLesson(lessonId: string) {
  const [state, setState] = useState<State>({ data: null, loading: true, error: "", notFound: false });
  const controller = useRef<AbortController | null>(null);
  const [regenerating, setRegenerating] = useState(false);

  const publish = useCallback((data: LessonState) => {
    setState({ data, loading: false, error: "", notFound: false });
  }, []);

  const follow = useCallback(async (initial?: LessonState) => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    try {
      const data = initial ?? await lessonApi.get(lessonId, current.signal);
      publish(data);
      if (data.generating) await followLesson(lessonId, data, { signal: current.signal, onUpdate: publish });
    } catch (error) {
      if (current.signal.aborted) return;
      const notFound = error instanceof StudyRequestError && error.status === 404;
      setState((s) => ({
        ...s, loading: false, notFound,
        error: notFound ? "" : error instanceof Error ? error.message : "Cannot load this lesson.",
      }));
    }
  }, [lessonId, publish]);

  useEffect(() => {
    void follow();
    return () => controller.current?.abort();
  }, [follow]);

  /** Retry a failed lesson or replace a ready one; previous content stays until replaced. */
  const regenerate = useCallback(async () => {
    if (regenerating) return;
    setRegenerating(true);
    try {
      const data = await lessonApi.regenerate(lessonId);
      void follow({ ...data, steps: [] });
    } catch (error) {
      setState((s) => ({ ...s, error: error instanceof Error ? error.message : "Regeneration failed." }));
    } finally {
      setRegenerating(false);
    }
  }, [lessonId, regenerating, follow]);

  return { ...state, regenerating, regenerate, reload: () => follow() };
}
