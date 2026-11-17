import { beforeEach, expect, it } from "vitest";
import { COURSES_KEY, LEGACY_COURSES_KEY, readCourses } from "@/core/study/cache";
import { LAST_MODE_KEY, LEGACY_LAST_MODE_KEY, readLastMode, writeLastMode } from "@/core/workspace/mode";

beforeEach(() => localStorage.clear());
const course = { id: "11111111-1111-4111-8111-111111111111", document_id: "22222222-2222-4222-8222-222222222222", title: "Old cached course", status: "ready",
  estimated_minutes: 10, module_count: 1, lesson_count: 2, completed_lessons: 1 };

it("keys use the Learn.si names", () => {
  expect(COURSES_KEY).toBe("learn-si.courses");
  expect(LAST_MODE_KEY).toBe("learn-si.last-mode");
});

it("the cached course list moves from the pre-rename key on first read", () => {
  localStorage.setItem(LEGACY_COURSES_KEY, JSON.stringify([course]));
  expect(readCourses(localStorage)).toHaveLength(1);
  expect(localStorage.getItem(COURSES_KEY)).toContain("Old cached course");
  expect(localStorage.getItem(LEGACY_COURSES_KEY)).toBeNull();
});

it("a newer list under the new key is never overwritten by the old one", () => {
  localStorage.setItem(COURSES_KEY, JSON.stringify([{ ...course, title: "New" }]));
  localStorage.setItem(LEGACY_COURSES_KEY, JSON.stringify([course]));
  expect(readCourses(localStorage)[0]!.title).toBe("New");
  expect(localStorage.getItem(LEGACY_COURSES_KEY)).toBeNull();
});

it("the last mode is still read from the pre-rename key, and writing replaces it", () => {
  localStorage.setItem(LEGACY_LAST_MODE_KEY, "master");
  expect(readLastMode(localStorage)).toBe("master");
  writeLastMode(localStorage, "ask");
  expect(readLastMode(localStorage)).toBe("ask");
  expect(localStorage.getItem(LEGACY_LAST_MODE_KEY)).toBeNull();
});
