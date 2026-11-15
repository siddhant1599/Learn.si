"use client";

import { useParams } from "next/navigation";
import { Suspense } from "react";

import { QuizView } from "@/components/study/quiz-view";
import { OutlineSkeleton } from "@/components/workspace/skeletons";

export default function QuizPage() {
  const { course_id, lesson_id } = useParams<{ course_id: string; lesson_id: string }>();
  return (
    <Suspense fallback={<OutlineSkeleton title="Quiz" />}>
      <QuizView key={lesson_id} courseId={course_id} lessonId={lesson_id} />
    </Suspense>
  );
}
