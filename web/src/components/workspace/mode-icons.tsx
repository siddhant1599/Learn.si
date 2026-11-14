import { GraduationCapIcon, MessagesSquareIcon, type LucideIcon } from "lucide-react";

import type { WorkspaceMode } from "@/core/workspace/mode";

export const MODE_ICONS: Record<WorkspaceMode, LucideIcon> = {
  ask: MessagesSquareIcon,
  master: GraduationCapIcon,
};
