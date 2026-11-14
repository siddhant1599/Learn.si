"use client";

import { LibraryIcon } from "lucide-react";

import { MasterEmptyPage } from "@/components/workspace/master-empty";

export default function CoursesPage() {
  return (
    <MasterEmptyPage
      title="Courses"
      heading="No courses yet"
      description="Master mode turns a document into modules of short lessons, each with a quiz, and tracks your progress. Course creation arrives with the next update."
      icon={<LibraryIcon className="size-8" />}
    />
  );
}
