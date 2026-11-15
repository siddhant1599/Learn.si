"use client";

import { ArrowLeftIcon, BookOpenIcon } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MasterEmptyPage } from "@/components/workspace/master-empty";
import { WorkspacePageHeader } from "@/components/workspace/page-header";
import { OutlineSkeleton } from "@/components/workspace/skeletons";
import { courseHref } from "@/core/study/format";
import { useCourse } from "@/core/study/use-course";

import { CourseStatusBadge } from "./course-status";
import { CoursePlan } from "./course-plan";
import { CourseProgressView } from "./course-progress-view";
import { GenerationFailed, GenerationProgress } from "./generation-progress";

export function CourseDetail({ courseId }: { courseId: string }) {
  const { course, steps, loading, error, notFound, retry, retrying, reload } = useCourse(courseId);
  const router = useRouter();
  const params = useSearchParams();
  const tab = params.get("tab") === "progress" ? "progress" : "plan";
  const selectTab = (value: string) =>
    router.replace(value === "progress" ? `${courseHref(courseId)}?tab=progress` : courseHref(courseId), { scroll: false });
  if (loading) return <OutlineSkeleton title="Course" />;
  if (notFound)
    return (
      <MasterEmptyPage
        title="Course"
        heading="This course is not available"
        description="It may have been deleted, or its source document was removed."
        icon={<BookOpenIcon className="size-8" />}
        action={{ href: "/workspace/courses", label: "Back to courses" }}
      />
    );
  return (
    <div className="flex size-full min-w-0 flex-col">
      <WorkspacePageHeader title={course?.title ?? "Course"}>
        {course && <CourseStatusBadge status={course.status} />}
      </WorkspacePageHeader>
      <div className="mx-auto w-full max-w-3xl min-w-0 space-y-6 overflow-y-auto px-4 py-6">
        <Link href="/workspace/courses" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeftIcon aria-hidden="true" className="size-3" />
          Back to courses
        </Link>
        {error && (
          <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive">
            <span>{error}</span>
            <Button size="sm" variant="outline" onClick={() => void reload()}>Retry</Button>
          </div>
        )}
        {course?.status === "generating" && <GenerationProgress steps={steps} />}
        {course?.status === "failed" && (
          <GenerationFailed code={course.failure_code} steps={steps} retrying={retrying} onRetry={() => void retry()} />
        )}
        {course?.status === "ready" && (
          <Tabs value={tab} onValueChange={selectTab} className="min-w-0">
            <TabsList>
              <TabsTrigger value="plan">Plan</TabsTrigger>
              <TabsTrigger value="progress">Progress</TabsTrigger>
            </TabsList>
            <TabsContent value="plan" className="pt-3"><CoursePlan course={course} /></TabsContent>
            <TabsContent value="progress" className="pt-3"><CourseProgressView course={course} /></TabsContent>
          </Tabs>
        )}
      </div>
    </div>
  );
}
