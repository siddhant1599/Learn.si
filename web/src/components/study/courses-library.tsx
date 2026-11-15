"use client";

import { LibraryIcon, PlusIcon, RefreshCwIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ConversationEmptyState } from "@/components/ai-elements/conversation";
import { Button } from "@/components/ui/button";
import { WorkspacePageHeader } from "@/components/workspace/page-header";
import { CourseGridSkeleton } from "@/components/workspace/skeletons";
import { useStudyStore } from "@/core/study/store";

import { CourseCard } from "./course-card";
import { CreateCourseDialog } from "./create-course-dialog";

export function CoursesLibrary() {
  const { courses, loading, error, refresh, remove } = useStudyStore();
  const [creating, setCreating] = useState(false);
  const showSkeleton = loading && courses.length === 0;
  if (showSkeleton) return <CourseGridSkeleton />;

  async function deleteCourse(id: string) {
    await remove(id);
    toast.success("Course deleted. The source document was kept.");
  }

  return (
    <div className="flex size-full min-w-0 flex-col">
      <WorkspacePageHeader title="Courses">
        {courses.length > 0 && (
          <Button size="sm" className="ml-auto gap-1" onClick={() => setCreating(true)}>
            <PlusIcon aria-hidden="true" className="size-4" />
            New course
          </Button>
        )}
      </WorkspacePageHeader>
      {error && (
        <div role="alert" className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-2 px-4 pt-2 text-sm text-destructive">
          <span className="min-w-0">{error}</span>
          <Button size="sm" variant="outline" className="gap-1" onClick={() => void refresh()}>
            <RefreshCwIcon aria-hidden="true" className="size-3" />
            Retry
          </Button>
        </div>
      )}
      {courses.length === 0 ? (
        !error && (
          <ConversationEmptyState>
            <div className="text-muted-foreground"><LibraryIcon className="size-8" /></div>
            <div className="max-w-md space-y-1">
              <h2 className="text-sm font-medium">No courses yet</h2>
              <p className="text-sm text-muted-foreground">
                Master mode turns a document into modules of short lessons, each with an exercise and a quiz, and tracks your progress. Learning time estimates are informational; nothing is timed.
              </p>
            </div>
            <Button className="mt-2 gap-1" size="sm" onClick={() => setCreating(true)}>
              <PlusIcon aria-hidden="true" className="size-4" />
              Add a document
            </Button>
          </ConversationEmptyState>
        )
      ) : (
        <ul className="mx-auto grid w-full max-w-5xl grid-cols-1 gap-4 px-4 py-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Your courses">
          {courses.map((course) => (
            <li key={course.id} className="min-w-0">
              <CourseCard course={course} onDelete={() => deleteCourse(course.id)} />
            </li>
          ))}
        </ul>
      )}
      <CreateCourseDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}
