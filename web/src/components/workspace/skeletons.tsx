import { Skeleton } from "@/components/ui/skeleton";

import { WorkspacePageHeader } from "./page-header";

/** Route-level loading UI for Master pages; shapes match the planned layouts. */
export function CourseGridSkeleton({ title = "Courses" }: { title?: string }) {
  return (
    <div className="flex size-full flex-col" aria-busy="true">
      <WorkspacePageHeader title={title} />
      <div className="mx-auto grid w-full max-w-5xl gap-4 px-4 py-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <div key={index} className="space-y-3 rounded-xl border p-5">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-2 w-full" />
            <Skeleton className="h-8 w-24" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function OutlineSkeleton({ title }: { title: string }) {
  return (
    <div className="flex size-full flex-col" aria-busy="true">
      <WorkspacePageHeader title={title} />
      <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6">
        <Skeleton className="h-7 w-1/2" />
        <Skeleton className="h-2 w-full" />
        {Array.from({ length: 2 }, (_, module) => (
          <div key={module} className="space-y-3 rounded-xl border p-5">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-5/6" />
            <Skeleton className="h-3 w-4/6" />
            <Skeleton className="h-3 w-3/6" />
          </div>
        ))}
      </div>
    </div>
  );
}
