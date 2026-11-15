"use client";

import { ArrowLeftIcon, CheckIcon, CircleAlertIcon, Loader2, XIcon } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { CitationList } from "@/components/chat/citation-list";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { WorkspacePageHeader } from "@/components/workspace/page-header";
import { OutlineSkeleton } from "@/components/workspace/skeletons";
import { lessonApi, quizApi, StudyRequestError } from "@/core/study/api";
import { courseHref, lessonHref, quizHref } from "@/core/study/format";
import { useStudyStore } from "@/core/study/store";
import type {
  LessonDetail,
  QuizAttemptView,
  QuizHistoryItem,
  QuizQuestion,
  QuizResult,
} from "@/core/study/types";
import { cn } from "@/lib/utils";

const PASS = 2;

function QuestionCard({
  question, index, value, onChange, disabled,
}: { question: QuizQuestion; index: number; value?: string; onChange: (v: string) => void; disabled: boolean }) {
  const legend = useId();
  return (
    <fieldset className="min-w-0 rounded-xl border p-5" aria-labelledby={legend} disabled={disabled}>
      <legend id={legend} className="sr-only">Question {index + 1}: {question.stem}</legend>
      <p aria-hidden="true" className="mb-1 text-xs text-muted-foreground">Question {index + 1} of 3</p>
      <p aria-hidden="true" className="mb-4 text-sm font-medium [overflow-wrap:anywhere]">{question.stem}</p>
      <RadioGroup value={value ?? ""} onValueChange={onChange} aria-labelledby={legend} className="gap-2">
        {question.options.map((option) => {
          const id = `${legend}-${option.id}`;
          return (
            <label
              key={option.id}
              htmlFor={id}
              className={cn(
                "flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm transition-colors",
                value === option.id ? "border-primary bg-primary/5" : "hover:bg-accent/50",
              )}
            >
              <RadioGroupItem id={id} value={option.id} className="mt-0.5" />
              <span className="min-w-0 [overflow-wrap:anywhere]">{option.text}</span>
            </label>
          );
        })}
      </RadioGroup>
    </fieldset>
  );
}

function ResultCard({ result, index }: { result: QuizResult; index: number }) {
  const explanation = useId();
  return (
    <article className="min-w-0 rounded-xl border p-5" aria-describedby={explanation} data-correct={result.correct}>
      <p className="mb-1 flex items-center gap-1 text-xs font-medium">
        {result.correct
          ? <><CheckIcon aria-hidden="true" className="size-4 text-emerald-600 dark:text-emerald-400" /> Question {index + 1}: correct</>
          : <><XIcon aria-hidden="true" className="size-4 text-destructive" /> Question {index + 1}: incorrect</>}
      </p>
      <p className="mb-3 text-sm font-medium [overflow-wrap:anywhere]">{result.stem}</p>
      <ul className="space-y-2">
        {result.options.map((option) => {
          const correct = option.id === result.correct_option_id;
          const chosen = option.id === result.chosen;
          return (
            <li
              key={option.id}
              className={cn(
                "flex items-start gap-2 rounded-lg border p-3 text-sm",
                correct && "border-emerald-600/50 bg-emerald-500/5",
                chosen && !correct && "border-destructive/50 bg-destructive/5",
              )}
            >
              {correct ? <CheckIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                : chosen ? <XIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive" />
                : <span aria-hidden="true" className="size-4 shrink-0" />}
              <span className="min-w-0 [overflow-wrap:anywhere]">
                {option.text}
                {(correct || chosen) && (
                  <span className="ml-1 text-xs text-muted-foreground">
                    ({[chosen && "your answer", correct && "correct answer"].filter(Boolean).join(", ")})
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      <div id={explanation} className="mt-3 space-y-1 text-sm">
        {!result.correct && result.explanation_for_chosen && (
          <p><span className="font-medium">Why your answer is wrong:</span> {result.explanation_for_chosen}</p>
        )}
        {result.explanation_for_correct && (
          <p><span className="font-medium">Why the correct answer is right:</span> {result.explanation_for_correct}</p>
        )}
      </div>
      {result.citation && <CitationList citations={[result.citation]} />}
    </article>
  );
}

function History({ items }: { items: QuizHistoryItem[] }) {
  const done = items.filter((item) => item.status === "submitted");
  if (!done.length) return null;
  return (
    <section aria-labelledby="history-heading" className="space-y-2">
      <h2 id="history-heading" className="text-sm font-medium">Previous attempts</h2>
      <ul className="space-y-1 text-sm text-muted-foreground">
        {done.map((item) => (
          <li key={item.id}>
            Attempt {item.attempt_number}: {item.score}/3 · {item.passed ? "Passed" : "Not passed"}
            {item.submitted_at && ` · ${new Date(item.submitted_at).toLocaleString()}`}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function QuizView({ courseId, lessonId }: { courseId: string; lessonId: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const attemptParam = params.get("attempt");
  const { refresh } = useStudyStore();
  const [lesson, setLesson] = useState<LessonDetail | null>(null);
  const [attempt, setAttempt] = useState<QuizAttemptView | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [history, setHistory] = useState<QuizHistoryItem[]>([]);
  const [busy, setBusy] = useState<"" | "starting" | "submitting">("starting");
  const [error, setError] = useState("");
  const [stale, setStale] = useState(false);
  const summary = useRef<HTMLDivElement>(null);
  const started = useRef<string | null>(null);

  const loadHistory = useCallback(() => {
    quizApi.history(lessonId).then(setHistory).catch(() => {});
  }, [lessonId]);

  const begin = useCallback(async () => {
    setBusy("starting");
    setError("");
    setStale(false);
    try {
      const created = await quizApi.start(lessonId);
      setAnswers({});
      setAttempt({ ...created, status: "open" });
      started.current = created.attempt_id;
      // A stable URL: refreshing reloads this same attempt.
      router.replace(quizHref(courseId, lessonId, created.attempt_id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "The quiz could not be generated. Please retry.");
    } finally {
      setBusy("");
    }
  }, [courseId, lessonId, router]);

  useEffect(() => {
    let live = true;
    lessonApi.get(lessonId).then((d) => { if (live) setLesson(d.lesson); }).catch(() => {});
    loadHistory();
    return () => { live = false; };
  }, [lessonId, loadHistory]);

  useEffect(() => {
    // Our own replace() lands here too; that attempt is already on screen.
    if (attemptParam && attemptParam === started.current) return;
    if (!attemptParam) {
      if (started.current === null) {
        started.current = "pending";
        void begin();
      }
      return;
    }
    started.current = attemptParam;
    setBusy("starting");
    quizApi.get(attemptParam)
      .then((loaded) => {
        if (loaded.lesson_id !== lessonId) throw new StudyRequestError("This attempt belongs to another lesson.", 404);
        setAttempt(loaded);
        if (loaded.status === "abandoned") setStale(true);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Cannot load this quiz attempt."))
      .finally(() => setBusy(""));
  }, [attemptParam, begin, lessonId]);

  async function submit() {
    if (!attempt || busy) return;
    setBusy("submitting");
    setError("");
    try {
      const result = await quizApi.submit(attempt.attempt_id, answers);
      setAttempt({ ...result, status: "submitted" });
      loadHistory();
      void refresh();  // Library and sidebar reflect completion and the unlock.
      requestAnimationFrame(() => summary.current?.focus());
    } catch (e) {
      if (e instanceof StudyRequestError && e.status === 409) setStale(true);
      // Answers stay in memory so a network retry needs no re-entry.
      setError(e instanceof Error ? e.message : "Submission failed. Your answers are kept; please retry.");
    } finally {
      setBusy("");
    }
  }

  if (!attempt && busy === "starting" && !error) return <OutlineSkeleton title="Quiz" />;
  const questions = attempt?.questions ?? [];
  const answered = questions.filter((q) => answers[q.id]).length;
  const submitted = attempt?.status === "submitted" && attempt.questions_with_results;
  const passed = !!attempt?.passed;
  const title = `Quiz · ${lesson?.title ?? "Lesson"}${attempt ? ` · Attempt ${attempt.attempt_number}` : ""}`;

  return (
    <div className="flex size-full min-w-0 flex-col">
      <WorkspacePageHeader title={title} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl min-w-0 space-y-5 px-4 py-6">
          <Link href={lessonHref(courseId, lessonId)} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeftIcon aria-hidden="true" className="size-3" />
            Back to the lesson
          </Link>
          {!submitted && (
            <p className="text-sm text-muted-foreground">
              Answer all three questions; 2 of 3 unlocks the next lesson. You can leave and come back to this attempt. Starting a new attempt replaces it with different questions.
            </p>
          )}
          {error && (
            <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <CircleAlertIcon aria-hidden="true" className="size-4" />
              <span className="min-w-0 flex-1">{error}</span>
              {!stale && !attempt && <Button size="sm" variant="outline" onClick={() => void begin()}>Retry</Button>}
            </div>
          )}
          {stale && (
            <div className="space-y-2 rounded-lg border p-4">
              <p className="text-sm">This attempt can no longer be submitted. It was replaced by a newer attempt or already submitted.</p>
              <Button size="sm" onClick={() => void begin()} disabled={!!busy}>Start a new attempt</Button>
            </div>
          )}
          {submitted ? (
            <>
              <div ref={summary} tabIndex={-1} role="status" aria-live="polite" className={cn(
                "space-y-3 rounded-xl border p-5 focus-visible:outline-none",
                passed ? "border-emerald-600/50 bg-emerald-500/5" : "border-amber-500/50 bg-amber-500/5",
              )} data-passed={passed}>
                <p className="text-lg font-medium">{attempt.score}/3 · {passed ? "Passed" : "Not passed"}</p>
                <p className="text-sm text-muted-foreground">
                  {passed
                    ? attempt.unlocked_lesson_id ? "Lesson complete. The next lesson is unlocked." : "Lesson complete."
                    : `You need ${PASS} of 3 to unlock the next lesson. A retake gives you different questions.`}
                </p>
                <div className="flex flex-wrap gap-2">
                  {passed && attempt.unlocked_lesson_id && (
                    <Button asChild><Link href={lessonHref(courseId, attempt.unlocked_lesson_id)}>Next lesson</Link></Button>
                  )}
                  {passed && !attempt.unlocked_lesson_id && (
                    <Button asChild><Link href={courseHref(courseId)}>Back to the course</Link></Button>
                  )}
                  {!passed && (
                    <Button onClick={() => void begin()} disabled={!!busy}>
                      {busy === "starting" && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
                      Retake with new questions
                    </Button>
                  )}
                  <Button asChild variant="outline"><Link href={lessonHref(courseId, lessonId)}>Back to the lesson</Link></Button>
                </div>
              </div>
              {attempt.questions_with_results!.map((result, index) => (
                <ResultCard key={result.id} result={result} index={index} />
              ))}
            </>
          ) : questions.length > 0 && !stale ? (
            <>
              {questions.map((question, index) => (
                <QuestionCard
                  key={`${attempt!.attempt_id}-${question.id}`}
                  question={question}
                  index={index}
                  value={answers[question.id]}
                  disabled={!!busy}
                  onChange={(value) => setAnswers((current) => ({ ...current, [question.id]: value }))}
                />
              ))}
              <div className="flex flex-wrap items-center justify-end gap-3">
                <p className="text-sm text-muted-foreground" aria-live="polite">{answered} of 3 answered</p>
                <Button onClick={() => void submit()} disabled={answered < 3 || !!busy}>
                  {busy === "submitting" && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
                  Submit answers
                </Button>
              </div>
            </>
          ) : busy === "starting" ? (
            <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 aria-hidden="true" className="size-4 animate-spin" />
              Writing new questions…
            </p>
          ) : null}
          <History items={history} />
        </div>
      </div>
    </div>
  );
}
