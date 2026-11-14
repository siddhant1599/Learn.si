"use client";

import { BookOpenIcon } from "lucide-react";

import { MasterEmptyPage } from "@/components/workspace/master-empty";

export default function CoursePage() {
  return (
    <MasterEmptyPage
      title="Course"
      heading="This course is not available yet"
      description="Lesson plans with modules, chapters and estimated learning time will appear here once course creation ships."
      icon={<BookOpenIcon className="size-8" />}
      action={{ href: "/workspace/courses", label: "Back to courses" }}
    />
  );
}
