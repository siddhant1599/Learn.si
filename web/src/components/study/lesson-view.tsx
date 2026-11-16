"use client";

import {
  ArrowLeftIcon,
  BookOpenIcon,
  CheckIcon,
  CircleAlertIcon,
  CircleDotIcon,
  CodeIcon,
  GlobeIcon,
  LightbulbIcon,
  Loader2,
  LockIcon,
  MoreHorizontalIcon,
  NotebookPenIcon,
  RefreshCwIcon,
  ScaleIcon,
  TriangleAlertIcon,
  WorkflowIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

import { CitationList } from "@/components/chat/citation-list";
import { Markdown } from "@/components/chat/message-list";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { MasterEmptyPage } from "@/components/workspace/master-empty";
import { WorkspacePageHeader } from "@/components/workspace/page-header";
import { OutlineSkeleton } from "@/components/workspace/skeletons";
import { studyApi, tutorApi } from "@/core/study/api";
import {
  courseHref,
  formatMinutes,
  lessonFailureReason,
  lessonHref,
  quizHref,
} from "@/core/study/format";
import type {
  CourseView,
  InsightKind,
  LessonContent,
  LessonDetail,
  YourTurnResult,
  YourTurnVerdict,
} from "@/core/study/types";
import { useLesson } from "@/core/study/use-lesson";
import { useStudyTime } from "@/core/study/use-study-time";
import { cn } from "@/lib/utils";

import { GenerationProgress } from "./generation-progress";
import { LessonTutor } from "./lesson-tutor";

const INSIGHTS: Record<InsightKind, { label: string; icon: LucideIcon }> = {
  why_it_matters: { label: "Why it matters", icon: LightbulbIcon },
  misconception: { label: "Common misconception", icon: TriangleAlertIcon },
  trade_off: { label: "Trade-off", icon: ScaleIcon },
};

const STATUS: Record<string, string> = {
  locked: "Locked", available: "Ready to start", in_progress: "In progress", completed: "Completed",
};

/** Module title and neighbours come from the course outline (one request, no polling). */
function useOutline(courseId: string) {
  const [course, setCourse] = useState<CourseView | null>(null);
  useEffect(() => {
    let live = true;
    studyApi.get(courseId)
      .then((d) => { if (live && Array.isArray(d.course?.modules)) setCourse(d.course); })
      .catch(() => {});
    return () => { live = false; };
  }, [courseId]);
  return course;
}

function Block({
  title, icon: Icon, children, className, id,
}: { title: string; icon: LucideIcon; children: React.ReactNode; className?: string; id?: string }) {
  const headingId = useId();
  return (
    <section id={id} aria-labelledby={headingId} className={cn("min-w-0 rounded-xl border p-5", className)}>
      <h2 id={headingId} className="mb-3 flex items-center gap-2 text-sm font-medium">
        <Icon aria-hidden="true" className="size-4 text-muted-foreground" />
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Code with the TODO(you) gap highlighted; focusable and scrollable without page overflow. */
function CodeWithGap({ code, language, marker }: { code: string; language: string; marker?: string }) {
  const lines = code.split("\n");
  return (
    <pre
      tabIndex={0}
      aria-label={`${language} code example`}
      className="max-w-full overflow-x-auto rounded-lg border bg-muted/40 p-4 font-mono text-[13px] leading-6 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <code>
        {lines.map((line, index) => {
          const gap = marker && line.includes(marker);
          return (
            <span key={index} className={cn("block", gap && "-mx-4 bg-amber-400/15 px-4")} data-gap={gap ? "true" : undefined}>
              {gap ? <mark className="bg-transparent text-amber-600 dark:text-amber-300">{line}</mark> : line || " "}
            </span>
          );
        })}
      </code>
    </pre>
  );
}

const VERDICTS: Record<YourTurnVerdict, { label: string; icon: LucideIcon; tone: string }> = {
  correct: { label: "Correct", icon: CheckIcon, tone: "text-emerald-600 dark:text-emerald-400" },
  partial: { label: "Partly right", icon: CircleDotIcon, tone: "text-amber-600 dark:text-amber-300" },
  incorrect: { label: "Not yet", icon: XIcon, tone: "text-destructive" },
};

function YourTurn({ lessonId, turn }: { lessonId: string; turn: LessonContent["your_turn"] }) {
  const id = useId();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<YourTurnResult | null>(null);
  const code = turn.kind === "code_gap";

  async function check(reveal = false) {
    if (busy || (!reveal && !draft.trim())) return;
    setBusy(true);
    setError("");
    try {
      setResult(await tutorApi.yourTurn(lessonId, draft, reveal));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Your answer could not be reviewed. Please retry.");
    } finally {
      setBusy(false);
    }
  }

  const verdict = result?.verdict ? VERDICTS[result.verdict] : null;
  return (
    <Block title="Your turn" icon={NotebookPenIcon} className="border-primary/40">
      <div className="space-y-3">
        <Markdown content={turn.prompt} isLoading={false} />
        <label htmlFor={id} className="sr-only">Your answer</label>
        <Textarea
          id={id}
          value={draft}
          maxLength={4000}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={code ? "Write the code for the TODO(you) line…" : "Write your answer…"}
          className={cn("min-h-24", code && "font-mono text-[13px]")}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" disabled={busy || !draft.trim()} onClick={() => void check()}>
            {busy && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
            Check my answer
          </Button>
          {!result?.reveal && (
            <button type="button" disabled={busy} onClick={() => void check(true)}
              className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground disabled:opacity-50">
              Show the answer
            </button>
          )}
          {result && <span className="text-xs text-muted-foreground">Attempt {result.attempt_number} of ∞</span>}
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div role="status" aria-live="polite" data-verdict={result?.verdict ?? ""}>
          {result && (
            <div className="space-y-2 rounded-lg border bg-muted/30 p-3 text-sm">
              {verdict && (
                <p className={cn("flex items-center gap-1.5 font-medium", verdict.tone)}>
                  <verdict.icon aria-hidden="true" className="size-4" /> {verdict.label}
                </p>
              )}
              <p>{result.feedback}</p>
              {result.reveal && (
                <div className="space-y-1 border-t pt-2">
                  <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">The answer</p>
                  {code ? (
                    <pre tabIndex={0} className="max-w-full overflow-x-auto rounded-md border bg-muted/40 p-3 font-mono text-[13px]"><code>{result.reveal.answer}</code></pre>
                  ) : (
                    <p className="[overflow-wrap:anywhere]">{result.reveal.answer}</p>
                  )}
                  {result.reveal.explanation && <p className="text-muted-foreground">{result.reveal.explanation}</p>}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Block>
  );
}

function LessonContentView({ lesson, content }: { lesson: LessonDetail; content: LessonContent }) {
  const code = content.code_example;
  return (
    <div className="space-y-4">
      {content.coverage_note && (
        <p role="note" className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
          <CircleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-300" />
          {content.coverage_note}
        </p>
      )}
      <Block title="Explanation" icon={BookOpenIcon}>
        <Markdown content={content.explanation} isLoading={false} />
        {content.citations.length > 0 && <CitationList citations={content.citations} />}
      </Block>
      {content.insights.map((insight, index) => {
        const meta = INSIGHTS[insight.kind];
        return (
          <aside key={index} role="note" aria-label={meta.label} className="flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4" data-insight={insight.kind}>
            <meta.icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
            <div className="min-w-0">
              <p className="text-xs font-semibold tracking-wide text-primary uppercase">{meta.label}</p>
              <div className="text-sm"><Markdown content={insight.text} isLoading={false} /></div>
            </div>
          </aside>
        );
      })}
      <Block title="Real-world example" icon={GlobeIcon}>
        <Markdown content={content.real_world_example} isLoading={false} />
      </Block>
      {content.diagram && (
        <Block title="Diagram" icon={WorkflowIcon}>
          <figure className="min-w-0">
            <div className="max-w-full overflow-x-auto">
              <Markdown content={"```mermaid\n" + content.diagram.source + "\n```"} isLoading={false} />
            </div>
            {content.diagram.caption && (
              <figcaption className="mt-2 text-xs text-muted-foreground">{content.diagram.caption}</figcaption>
            )}
          </figure>
        </Block>
      )}
      {code && (
        <Block title="Code example" icon={CodeIcon}>
          <div className="space-y-3">
            <CodeWithGap code={code.code} language={code.language} marker={code.todo?.marker} />
            <Markdown content={code.explanation} isLoading={false} />
            {code.todo && (
              <p className="text-sm"><span className="font-medium">TODO(you):</span> {code.todo.instruction}</p>
            )}
          </div>
        </Block>
      )}
      {content.key_terms.length > 0 && (
        <Block title="Key terms" icon={BookOpenIcon}>
          <dl className="space-y-2 text-sm">
            {content.key_terms.map((term) => (
              <div key={term.term}>
                <dt className="font-medium">{term.term}</dt>
                <dd className="text-muted-foreground">{term.definition}</dd>
              </div>
            ))}
          </dl>
        </Block>
      )}
      <YourTurn key={lesson.id} lessonId={lesson.id} turn={content.your_turn} />
    </div>
  );
}

function ContentSkeleton() {
  return (
    <div className="space-y-4" aria-hidden="true">
      {["Explanation", "Real-world example", "Diagram", "Your turn"].map((name) => (
        <div key={name} className="space-y-3 rounded-xl border p-5">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-5/6" />
        </div>
      ))}
    </div>
  );
}

function RegenerateMenu({ left, busy, onConfirm }: { left: number; busy: boolean; onConfirm: () => void }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button ref={trigger} variant="ghost" size="icon-sm" aria-label="Lesson options" className="ml-auto">
            <MoreHorizontalIcon className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem disabled={left <= 0 || busy} onSelect={() => setOpen(true)}>
            <RefreshCwIcon className="size-4" />
            Regenerate lesson
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md" onCloseAutoFocus={(event) => { event.preventDefault(); trigger.current?.focus(); }}>
          <DialogTitle>Regenerate this lesson?</DialogTitle>
          <DialogDescription>
            A new version is written from the same sections. The current version stays until the new one is ready, and your progress and quiz attempts are kept. {left} regeneration{left === 1 ? "" : "s"} left today.
          </DialogDescription>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => { setOpen(false); onConfirm(); }}>Regenerate</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function LessonView({ courseId, lessonId }: { courseId: string; lessonId: string }) {
  const { data, loading, error, notFound, regenerate, regenerating, reload } = useLesson(lessonId);
  const course = useOutline(courseId);
  const studying = !!data && data.lesson.content_status === "ready" &&
    ["in_progress", "completed"].includes(data.lesson.progress.status);
  useStudyTime(lessonId, studying);
  if (loading) return <OutlineSkeleton title="Lesson" />;
  if (notFound || (data && data.lesson.course_id !== courseId))
    return (
      <MasterEmptyPage
        title="Lesson"
        heading="This lesson is not available"
        description="It may have been deleted, or the link is wrong."
        icon={<NotebookPenIcon className="size-8" />}
        action={{ href: courseHref(courseId), label: "Back to the course" }}
      />
    );
  const lesson = data?.lesson;
  const lessons = course?.modules.flatMap((m) => m.lessons) ?? [];
  const lessonModule = course?.modules.find((m) => m.id === lesson?.module_id);
  const previous = lesson ? lessons.find((l) => l.position === lesson.position - 1) : undefined;
  const locked = lesson?.progress.status === "locked";
  const ready = lesson?.content_status === "ready" && !!lesson.content;
  const estimate = lesson ? formatMinutes(lesson.estimated_minutes) : "";

  return (
    <div className="flex size-full min-w-0 flex-col">
      <WorkspacePageHeader title={lesson?.title ?? "Lesson"}>
        {lesson && ready && !locked && (
          <RegenerateMenu left={lesson.regenerations_left} busy={regenerating || !!data?.generating} onConfirm={() => void regenerate()} />
        )}
      </WorkspacePageHeader>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid w-full max-w-6xl min-w-0 gap-6 px-4 py-6 xl:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0 space-y-6">
            <nav aria-label="Breadcrumb" className="flex min-w-0 flex-wrap items-center gap-1 text-xs text-muted-foreground">
              <Link href={courseHref(courseId)} className="inline-flex items-center gap-1 hover:text-foreground">
                <ArrowLeftIcon aria-hidden="true" className="size-3" />
                {course?.title ?? "Course"}
              </Link>
              {lessonModule && <><span aria-hidden="true">›</span><span className="[overflow-wrap:anywhere]">{lessonModule.title}</span></>}
            </nav>
            {lesson && (
              <div className="space-y-1">
                <p className="text-sm [overflow-wrap:anywhere]">{lesson.content?.objective || lesson.objective}</p>
                <p className="text-xs text-muted-foreground">
                  {STATUS[lesson.progress.status]}
                  {estimate && ` · ${estimate} (estimate only; nothing is timed)`}
                </p>
              </div>
            )}
            {error && (
              <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive">
                <span>{error}</span>
                <Button size="sm" variant="outline" onClick={() => void reload()}>Retry</Button>
              </div>
            )}
            {locked && (
              <div className="space-y-3 rounded-xl border p-5">
                <p className="flex items-center gap-2 text-sm font-medium"><LockIcon aria-hidden="true" className="size-4" /> This lesson is locked</p>
                <p className="text-sm text-muted-foreground">Pass the previous lesson's quiz (2 of 3) to unlock it.</p>
                {previous && (
                  <Button asChild size="sm" variant="outline">
                    <Link href={lessonHref(courseId, previous.id)}>Go to the previous lesson</Link>
                  </Button>
                )}
              </div>
            )}
            {lesson && !locked && lesson.content_failure_code && ready && (
              <p role="status" className="text-xs text-muted-foreground">
                The last regeneration did not finish ({lessonFailureReason(lesson.content_failure_code)}). Showing the previous version.
              </p>
            )}
            {lesson && !locked && data?.generating && (
              <>
                <GenerationProgress
                  steps={data.steps}
                  title={lesson.content ? "Writing a new version" : "Writing this lesson"}
                  description="Gathering the lesson's sources, writing it and checking every citation. This usually takes under a minute."
                />
                {!lesson.content && <ContentSkeleton />}
              </>
            )}
            {lesson && !locked && lesson.content_status === "failed" && (
              <div role="alert" className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
                <p className="flex items-center gap-2 text-sm font-medium"><CircleAlertIcon aria-hidden="true" className="size-4 text-destructive" /> This lesson could not be written</p>
                <p className="text-sm text-muted-foreground">{lessonFailureReason(lesson.content_failure_code)}</p>
                {lesson.regenerations_left > 0 ? (
                  <Button size="sm" disabled={regenerating} onClick={() => void regenerate()}>
                    {regenerating && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
                    Retry
                  </Button>
                ) : (
                  <p className="text-xs text-muted-foreground">The daily retry limit for this lesson is reached. Try again tomorrow.</p>
                )}
              </div>
            )}
            {lesson && !locked && lesson.content && <LessonContentView lesson={lesson} content={lesson.content} />}
          </div>
          {lesson && !locked && <LessonTutor lessonId={lesson.id} documentId={lesson.document_id} />}
        </div>
      </div>
      {lesson && !locked && (
        <footer className="shrink-0 border-t bg-background/95 px-4 py-3 backdrop-blur">
          <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-end gap-3">
            {!ready && <p className="text-xs text-muted-foreground">The quiz opens once the lesson is ready.</p>}
            {ready ? (
              <Button asChild>
                <Link href={quizHref(courseId, lessonId)}>Take the quiz</Link>
              </Button>
            ) : (
              <Button disabled>Take the quiz</Button>
            )}
          </div>
        </footer>
      )}
    </div>
  );
}
