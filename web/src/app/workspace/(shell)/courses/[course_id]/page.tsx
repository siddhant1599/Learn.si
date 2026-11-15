"use client";

import { useParams } from "next/navigation";

import { CourseDetail } from "@/components/study/course-detail";

export default function CoursePage() {
  const { course_id } = useParams<{ course_id: string }>();
  return <CourseDetail key={course_id} courseId={course_id} />;
}
