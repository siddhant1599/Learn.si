import { CircleAlertIcon, Loader2 } from "lucide-react";

import { MessageSteps } from "@/components/chat/message-steps";
import { Button } from "@/components/ui/button";
import type { ChatStep } from "@/core/chat/types";
import { failureReason } from "@/core/study/format";

/** Plan generation in the chat activity panel's visual language. */
export function GenerationProgress({ steps }: { steps: ChatStep[] }) {
  return (
    <section aria-labelledby="generation-heading" className="space-y-3">
      <div className="space-y-1">
        <h2 id="generation-heading" className="text-base font-medium">Preparing your lesson plan</h2>
        <p className="text-sm text-muted-foreground">
          Reading the document, finding topics and organizing lessons. This can take a few minutes; you can leave and come back.
        </p>
      </div>
      {steps.length ? (
        <MessageSteps steps={steps} detailsLabel="Document parts" />
      ) : (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
          Starting…
        </p>
      )}
    </section>
  );
}

export function GenerationFailed({
  code, steps, retrying, onRetry,
}: { code?: string | null; steps: ChatStep[]; retrying: boolean; onRetry: () => void }) {
  return (
    <section aria-labelledby="failed-heading" className="space-y-3">
      <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
        <CircleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive" />
        <div className="min-w-0 space-y-2">
          <h2 id="failed-heading" className="text-sm font-medium">The lesson plan could not be prepared</h2>
          <p className="text-sm text-muted-foreground">{failureReason(code)} Retrying starts a fresh plan; the document is unchanged.</p>
          <Button size="sm" disabled={retrying} onClick={onRetry}>
            {retrying && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
            Retry
          </Button>
        </div>
      </div>
      {steps.length > 0 && <MessageSteps steps={steps} detailsLabel="Document parts" />}
    </section>
  );
}
