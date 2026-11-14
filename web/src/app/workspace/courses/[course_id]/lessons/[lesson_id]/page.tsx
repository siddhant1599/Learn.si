"use client";

import { NotebookPenIcon } from "lucide-react";
import { useParams } from "next/navigation";

import { MasterEmptyPage } from "@/components/workspace/master-empty";

export default function LessonPage() {
  const { course_id } = useParams<{ course_id: string; lesson_id: string }>();
  return (
    <MasterEmptyPage
      title="Lesson"
      heading="This lesson is not available yet"
      description="Interactive lessons with an example, a diagram, Insight callouts, a Your turn exercise and a tutor will open here once lessons ship."
      icon={<NotebookPenIcon className="size-8" />}
      action={{
        href: `/workspace/courses/${encodeURIComponent(course_id)}`,
        label: "Back to the course",
      }}
    />
  );
}
