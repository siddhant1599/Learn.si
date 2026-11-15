"use client";

import { useParams } from "next/navigation";

import { LessonView } from "@/components/study/lesson-view";

export default function LessonPage() {
  const { course_id, lesson_id } = useParams<{ course_id: string; lesson_id: string }>();
  return <LessonView key={lesson_id} courseId={course_id} lessonId={lesson_id} />;
}
