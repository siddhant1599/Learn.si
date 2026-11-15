"use client";

import { useParams } from "next/navigation";
import { Suspense } from "react";

import { CourseDetail } from "@/components/study/course-detail";
import { OutlineSkeleton } from "@/components/workspace/skeletons";

export default function CoursePage() {
  const { course_id } = useParams<{ course_id: string }>();
  return (
    <Suspense fallback={<OutlineSkeleton title="Course" />}>
      <CourseDetail key={course_id} courseId={course_id} />
    </Suspense>
  );
}
