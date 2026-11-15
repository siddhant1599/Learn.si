import { CircleAlertIcon, CircleCheckIcon, LoaderCircleIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { STATUS_LABEL } from "@/core/study/format";
import type { CourseStatus } from "@/core/study/types";

/** Status in words with an icon; color is never the only signal. */
export function CourseStatusBadge({ status }: { status: CourseStatus }) {
  const Icon = status === "generating" ? LoaderCircleIcon : status === "failed" ? CircleAlertIcon : CircleCheckIcon;
  return (
    <Badge
      variant={status === "failed" ? "destructive" : status === "ready" ? "secondary" : "outline"}
      className="gap-1"
    >
      <Icon aria-hidden="true" className={status === "generating" ? "animate-spin motion-reduce:animate-none" : undefined} />
      {STATUS_LABEL[status]}
    </Badge>
  );
}
