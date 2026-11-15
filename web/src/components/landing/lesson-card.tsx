"use client";

import { ArrowDownIcon, ArrowLeftIcon, ArrowRightIcon, ArrowUpIcon, CheckIcon, LightbulbIcon, XIcon } from "lucide-react";
import { useId, useState } from "react";

import {
  demoLesson,
  gradeOrder,
  gradeQuiz,
  type DemoQuizQuestion,
  type OrderVerdict,
} from "@/content/landing-demo";
import { usePrefersReducedMotion } from "@/core/dom/render-activity";
import { cn } from "@/lib/utils";

const GOLD = "text-[#e9c665]";

/**
 * Flippable preview of one Master-mode lesson: front teaches with an Insight
 * callout and an ordering exercise; back is a 3-question quiz. Passing calls onPass.
 */
export function LessonCard({
  onPass,
  passed,
  className,
}: {
  onPass: (firstTry: boolean) => void;
  passed: boolean;
  className?: string;
}) {
  const reduced = usePrefersReducedMotion();
  const [side, setSide] = useState<"lesson" | "quiz">("lesson");
  const quizSide = side === "quiz";
  return (
    <div className={cn("[perspective:1600px]", className)} data-lesson-card data-side={side}>
      <div
        className={cn(
          "relative grid [transform-style:preserve-3d] transition-transform duration-700 ease-[cubic-bezier(.4,0,.2,1)] motion-reduce:transition-none",
          quizSide && !reduced && "[transform:rotateY(180deg)]",
        )}
      >
        <Face hidden={quizSide} back={false}>
          <LessonFront onQuiz={() => setSide("quiz")} />
        </Face>
        <Face hidden={!quizSide} back={!reduced}>
          <QuizBack onBack={() => setSide("lesson")} onPass={onPass} passed={passed} />
        </Face>
      </div>
    </div>
  );
}

function Face({ children, hidden, back }: { children: React.ReactNode; hidden: boolean; back: boolean }) {
  return (
    <div
      aria-hidden={hidden}
      inert={hidden || undefined}
      className={cn(
        "col-start-1 row-start-1 rounded-2xl border border-white/15 bg-[#14110c]/95 p-6 shadow-2xl [backface-visibility:hidden] sm:p-8",
        back && "[transform:rotateY(180deg)]",
        hidden && "pointer-events-none motion-reduce:opacity-0",
      )}
    >
      {children}
    </div>
  );
}

function LessonFront({ onQuiz }: { onQuiz: () => void }) {
  const lesson = demoLesson;
  return (
    <article>
      <header className="mb-5">
        <p className="text-[11px] tracking-widest text-white/50 uppercase">{lesson.label}</p>
        <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 className="font-serif text-3xl leading-none text-white">
            Lesson {lesson.number} · {lesson.title}
          </h3>
          <span className="text-sm text-white/60">
            {lesson.module} · ≈ {lesson.minutes} min
          </span>
        </div>
        <p className="mt-3 text-sm text-white/70">{lesson.objective}</p>
      </header>
      <div className="space-y-4 text-[15px] leading-7 text-white/85">
        {lesson.explanation.map((paragraph) => (
          <p key={paragraph.slice(0, 24)}>{paragraph}</p>
        ))}
      </div>
      <aside
        role="note"
        className="mt-5 flex gap-3 rounded-xl border border-[#e9c665]/30 bg-[#e9c665]/[0.06] p-4"
      >
        <LightbulbIcon aria-hidden="true" className={cn("mt-0.5 size-4 shrink-0", GOLD)} />
        <div>
          <p className={cn("text-[11px] font-semibold tracking-widest uppercase", GOLD)}>
            Insight · {lesson.insight.kind}
          </p>
          <p className="mt-1 text-sm leading-6 text-white/85">{lesson.insight.text}</p>
        </div>
      </aside>
      <OrderExercise />
      <footer className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-5">
        <p className="text-xs text-white/50">
          Grounded in: {lesson.sources.map((s) => `“${s}”`).join(" · ")}
        </p>
        <button
          type="button"
          onClick={onQuiz}
          className="flex items-center gap-2 rounded-md border border-white/20 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-white/10"
        >
          Take the quiz <ArrowRightIcon aria-hidden="true" className="size-4" />
        </button>
      </footer>
    </article>
  );
}

/** "Your turn": put four steps in order with keyboard-friendly move buttons. */
function OrderExercise() {
  const { order } = demoLesson;
  const byId = new Map(order.steps.map((step) => [step.id, step]));
  const [ids, setIds] = useState<string[]>(order.start);
  const [verdict, setVerdict] = useState<OrderVerdict | null>(null);
  const [tries, setTries] = useState(0);
  const headingId = useId();
  const correctIds = order.steps.map((step) => step.id);
  const solved = verdict === "correct";
  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= ids.length) return;
    const next = [...ids];
    [next[index], next[target]] = [next[target]!, next[index]!];
    setIds(next);
    setVerdict(null);
  };
  const check = () => {
    setVerdict(gradeOrder(ids).verdict);
    setTries((n) => n + 1);
  };
  return (
    <section className="mt-6" aria-labelledby={headingId} data-order-exercise>
      <p id={headingId} className={cn("text-[11px] font-semibold tracking-widest uppercase", GOLD)}>
        Your turn · set the order
      </p>
      <p className="mt-1 text-sm text-white/70">{order.prompt}</p>
      <ol className="mt-3 space-y-2" aria-label="Steps in your order">
        {ids.map((id, index) => {
          const step = byId.get(id)!;
          const placed = verdict !== null && correctIds[index] === id;
          const misplaced = verdict !== null && correctIds[index] !== id;
          return (
            <li
              key={id}
              data-order-item={id}
              data-placed={verdict === null ? undefined : placed}
              className={cn(
                "flex items-center gap-3 rounded-lg border px-3 py-2 text-sm transition-colors",
                verdict === null && "border-white/10 bg-white/[0.03]",
                placed && "border-emerald-400/50 bg-emerald-400/10",
                misplaced && "border-rose-400/40 bg-rose-400/[0.08]",
              )}
            >
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-white/20 text-xs text-white/70">
                {index + 1}
              </span>
              <span className="flex-1 text-white/85">{step.text}</span>
              {placed && (
                <CheckIcon aria-label="In the right place" className="size-4 shrink-0 text-emerald-300" />
              )}
              <span className="flex shrink-0 gap-1">
                <button
                  type="button"
                  aria-label={`Move up: ${step.text}`}
                  disabled={index === 0 || solved}
                  onClick={() => move(index, -1)}
                  className="rounded-md border border-white/15 p-1.5 text-white/70 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e9c665] disabled:cursor-not-allowed disabled:opacity-30"
                >
                  <ArrowUpIcon aria-hidden="true" className="size-3.5" />
                </button>
                <button
                  type="button"
                  aria-label={`Move down: ${step.text}`}
                  disabled={index === ids.length - 1 || solved}
                  onClick={() => move(index, 1)}
                  className="rounded-md border border-white/15 p-1.5 text-white/70 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e9c665] disabled:cursor-not-allowed disabled:opacity-30"
                >
                  <ArrowDownIcon aria-hidden="true" className="size-3.5" />
                </button>
              </span>
            </li>
          );
        })}
      </ol>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={check}
          disabled={solved}
          className="rounded-md bg-white px-3 py-1.5 text-sm font-medium text-black transition-colors hover:bg-white/90 disabled:opacity-60"
        >
          Check order
        </button>
        {tries >= 2 && !solved && (
          <button
            type="button"
            onClick={() => {
              setIds(correctIds);
              setVerdict("correct");
            }}
            className="text-sm text-white/60 underline underline-offset-4 hover:text-white"
          >
            Show the order
          </button>
        )}
      </div>
      <p role="status" aria-live="polite" className="mt-3 min-h-6 text-sm" data-order-verdict={verdict ?? ""}>
        {verdict === "correct" && (
          <span className="flex items-center gap-2 text-emerald-300">
            <CheckIcon aria-hidden="true" className="size-4" /> {order.feedback.correct}
          </span>
        )}
        {verdict === "partial" && <span className={GOLD}>{order.feedback.partial}</span>}
        {verdict === "incorrect" && <span className="text-rose-300">{order.feedback.incorrect}</span>}
      </p>
    </section>
  );
}

function QuizBack({
  onBack,
  onPass,
  passed,
}: {
  onBack: () => void;
  onPass: (firstTry: boolean) => void;
  passed: boolean;
}) {
  const [attempt, setAttempt] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ score: number; passed: boolean } | null>(null);
  const bank = demoLesson.quizBanks[attempt % demoLesson.quizBanks.length]!;
  const complete = bank.every((q) => answers[q.id]);
  const submit = () => {
    const graded = gradeQuiz(bank, answers);
    setResult(graded);
    if (graded.passed) onPass(attempt === 0);
  };
  const retake = () => {
    setAttempt((n) => n + 1);
    setAnswers({});
    setResult(null);
  };
  return (
    <div data-quiz data-attempt={attempt + 1}>
      <header className="mb-5">
        <p className="text-[11px] tracking-widest text-white/50 uppercase">
          Quiz · Lesson {demoLesson.number} · attempt {attempt + 1}
        </p>
        <h3 className="mt-3 font-serif text-3xl leading-none text-white">Check your understanding</h3>
        <p className="mt-3 text-sm text-white/70">
          Three questions. Pass {demoLesson.passScore} of 3 to unlock the next lesson; a retake brings new questions.
        </p>
      </header>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (complete && !result) submit();
        }}
        className="space-y-6"
      >
        {bank.map((question, index) => (
          <Question
            key={question.id}
            index={index}
            question={question}
            chosen={answers[question.id]}
            locked={result !== null}
            onChoose={(id) => setAnswers((current) => ({ ...current, [question.id]: id }))}
          />
        ))}
        {!result && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-white/50">
              {Object.keys(answers).length} of 3 answered
            </p>
            <button
              type="submit"
              disabled={!complete}
              className="rounded-md bg-white px-4 py-2 text-sm font-medium text-black transition-colors hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Submit answers
            </button>
          </div>
        )}
      </form>
      {result && (
        <div
          role="status"
          aria-live="polite"
          data-quiz-result={result.passed ? "passed" : "failed"}
          className={cn(
            "mt-6 rounded-xl border p-4",
            result.passed ? "border-[#e9c665]/40 bg-[#e9c665]/[0.08]" : "border-white/15 bg-white/[0.04]",
          )}
        >
          <p className="font-medium text-white">
            {result.score}/3 · {result.passed ? "Passed" : "Not passed yet"}
          </p>
          <p className="mt-1 text-sm text-white/70">
            {result.passed
              ? "Lesson 4 is complete. On the map, Pods turns gold and Deployments opens."
              : `You need ${demoLesson.passScore} of 3. Retake with a fresh set of questions.`}
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            {!result.passed && (
              <button
                type="button"
                onClick={retake}
                className="rounded-md bg-white px-3 py-1.5 text-sm font-medium text-black hover:bg-white/90"
              >
                Retake with new questions
              </button>
            )}
            <button
              type="button"
              onClick={onBack}
              className="flex items-center gap-2 rounded-md border border-white/20 px-3 py-1.5 text-sm text-white hover:bg-white/10"
            >
              <ArrowLeftIcon aria-hidden="true" className="size-4" /> Back to the lesson
            </button>
          </div>
        </div>
      )}
      {!result && (
        <button
          type="button"
          onClick={onBack}
          className="mt-5 flex items-center gap-2 text-sm text-white/60 hover:text-white"
        >
          <ArrowLeftIcon aria-hidden="true" className="size-4" /> Back to the lesson
        </button>
      )}
      {passed && !result && (
        <p className="mt-3 text-xs text-white/50">You already passed this quiz; retaking does not change your progress.</p>
      )}
    </div>
  );
}

function Question({
  index,
  question,
  chosen,
  locked,
  onChoose,
}: {
  index: number;
  question: DemoQuizQuestion;
  chosen?: string;
  locked: boolean;
  onChoose: (id: string) => void;
}) {
  const name = `demo-${question.id}`;
  return (
    <fieldset className="rounded-xl border border-white/10 p-4" data-question={question.id}>
      <legend className="px-1 text-sm font-medium text-white">
        {index + 1}. {question.stem}
      </legend>
      <div className="mt-2 space-y-2">
        {question.options.map((option) => {
          const isChosen = chosen === option.id;
          const isCorrect = option.id === question.correct;
          const showState = locked && (isChosen || isCorrect);
          return (
            <label
              key={option.id}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 text-sm transition-colors",
                !locked && "border-white/10 hover:bg-white/[0.05]",
                !locked && isChosen && "border-white/40 bg-white/[0.06]",
                showState && isCorrect && "border-emerald-400/50 bg-emerald-400/10",
                showState && isChosen && !isCorrect && "border-rose-400/50 bg-rose-400/10",
                locked && !showState && "border-white/10 opacity-60",
              )}
            >
              <input
                type="radio"
                name={name}
                value={option.id}
                checked={isChosen}
                disabled={locked}
                onChange={() => onChoose(option.id)}
                className="mt-1 size-3.5 accent-[#e9c665]"
              />
              <span className="flex-1 text-white/85">{option.text}</span>
              {showState && isCorrect && <CheckIcon aria-label="Correct answer" className="size-4 text-emerald-300" />}
              {showState && isChosen && !isCorrect && <XIcon aria-label="Your answer" className="size-4 text-rose-300" />}
            </label>
          );
        })}
      </div>
      {locked && chosen && (
        <p className="mt-3 text-xs leading-5 text-white/70" data-explanation>
          {chosen !== question.correct && <>{question.explanations[chosen]} </>}
          <span className="text-white/90">{question.explanations[question.correct]}</span>
        </p>
      )}
    </fieldset>
  );
}
