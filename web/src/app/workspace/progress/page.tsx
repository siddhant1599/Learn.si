"use client";

import { TrendingUpIcon } from "lucide-react";

import { MasterEmptyPage } from "@/components/workspace/master-empty";

export default function ProgressPage() {
  return (
    <MasterEmptyPage
      title="Progress"
      heading="No progress yet"
      description="Course progress, lesson completion, quiz performance, topic mastery and study time will be tracked here once you start a course."
      icon={<TrendingUpIcon className="size-8" />}
      action={{ href: "/workspace/courses", label: "Go to courses" }}
    />
  );
}
