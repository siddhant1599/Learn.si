"use client";

import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { useChatStore } from "@/core/chat/store";
import { modeFromPathname } from "@/core/workspace/mode";

import { studyApi } from "./api";
import { readCourses, sanitizeCourse, writeCourses } from "./cache";
import type { CourseSummary } from "./types";

type StudyStore = {
  courses: CourseSummary[];
  /** True until the first server listing settles (cached courses may show meanwhile). */
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
  create: (documentId: string) => Promise<CourseSummary>;
  remove: (id: string) => Promise<void>;
  /** Record a fresher server view of one course (from its detail page). */
  upsert: (course: CourseSummary) => void;
};

const StudyStoreContext = createContext<StudyStore | null>(null);

export function useStudyStore() {
  const store = useContext(StudyStoreContext);
  if (!store) throw new Error("useStudyStore must be used within StudyStoreProvider");
  return store;
}

type Deletion = { kind: string; id: string };

/** Drop courses whose course or source-document tombstone exists. */
export function reconcileCourses(courses: CourseSummary[], deletions: Deletion[]): CourseSummary[] {
  if (!deletions.length) return courses;
  const gone = new Set(deletions.filter((d) => d.kind === "course").map((d) => d.id));
  const documents = new Set(deletions.filter((d) => d.kind === "document").map((d) => d.id));
  const kept = courses.filter((c) => !gone.has(c.id) && !documents.has(c.document_id));
  return kept.length === courses.length ? courses : kept;
}

export function StudyStoreProvider({ children }: { children: ReactNode }) {
  // Tombstones are already polled by the chat store (startup, focus, every 5 s).
  const { deletions } = useChatStore();
  const inMaster = modeFromPathname(usePathname()) === "master";
  const [courses, setCourses] = useState<CourseSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const deletionsRef = useRef(deletions);
  deletionsRef.current = deletions;

  useEffect(() => {
    try {
      const cached = readCourses(localStorage);
      // A listing that already arrived wins over the cache.
      setCourses((current) => (current.length ? current : cached));
    } catch { /* storage blocked */ }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try { writeCourses(localStorage, courses); } catch { /* storage blocked */ }
  }, [hydrated, courses]);

  useEffect(() => {
    setCourses((current) => reconcileCourses(current, deletions));
  }, [deletions]);

  const refresh = useCallback(async () => {
    try {
      const listed = await studyApi.list();
      // Server order: most recently updated first.
      const valid = listed.filter((c) => sanitizeCourse(c) !== null);
      setCourses(reconcileCourses(valid, deletionsRef.current));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cannot load courses.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Only Master pages need the listing; Ask never calls the course API.
  useEffect(() => {
    if (inMaster) void refresh();
  }, [inMaster, refresh]);

  const upsert = useCallback((course: CourseSummary) => {
    setCourses((current) => {
      const index = current.findIndex((c) => c.id === course.id);
      if (index < 0) return reconcileCourses([course, ...current], deletionsRef.current);
      const next = [...current];
      next[index] = { ...next[index], ...course };
      return next;
    });
  }, []);

  const create = useCallback(async (documentId: string) => {
    const course = await studyApi.create(documentId);
    upsert(course);
    return course;
  }, [upsert]);

  const remove = useCallback(async (id: string) => {
    await studyApi.remove(id);
    setCourses((current) => current.filter((c) => c.id !== id));
  }, []);

  const value = useMemo(
    () => ({ courses, loading, error, refresh, create, remove, upsert }),
    [courses, loading, error, refresh, create, remove, upsert],
  );
  return <StudyStoreContext.Provider value={value}>{children}</StudyStoreContext.Provider>;
}
