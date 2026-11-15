"use client";

import { ArrowLeftIcon, ArrowRightIcon, CheckIcon, LightbulbIcon, XIcon } from "lucide-react";
import { useId, useState } from "react";

import {
  demoLesson,
  gradeImage,
  gradeQuiz,
  type DemoQuizQuestion,
  type GapVerdict,
} from "@/content/landing-demo";
import { usePrefersReducedMotion } from "@/core/dom/render-activity";
import { cn } from "@/lib/utils";

const GOLD = "text-[#e9c665]";

/**
 * Flippable preview of one Master-mode lesson: front teaches with an Insight
 * callout and a TODO(you) gap; back is a 3-question quiz. Passing calls onPass.
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
  const [value, setValue] = useState("");
  const [verdict, setVerdict] = useState<GapVerdict | null>(null);
  const [tries, setTries] = useState(0);
  const inputId = useId();
  const lesson = demoLesson;
  const check = () => {
    setVerdict(gradeImage(value));
    setTries((n) => n + 1);
  };
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
      <section className="mt-6" aria-labelledby={`${inputId}-label`}>
        <p id={`${inputId}-label`} className={cn("text-[11px] font-semibold tracking-widest uppercase", GOLD)}>
          Your turn · TODO(you)
        </p>
        <p className="mt-1 text-sm text-white/70">{lesson.code.instruction}</p>
        <pre className="mt-3 overflow-x-auto rounded-lg border border-white/10 bg-black/40 p-4 font-mono text-[13px] leading-6 text-white/85">
          <code>
            {lesson.code.before}
            <input
              id={inputId}
              aria-label="Image for the web container"
              value={value}
              onChange={(event) => {
                setValue(event.target.value);
                setVerdict(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") check();
              }}
              placeholder={lesson.code.placeholder}
              spellCheck={false}
              className="mx-0.5 inline-block w-40 rounded border border-[#e9c665]/50 bg-[#e9c665]/10 px-2 font-mono text-[13px] text-white outline-none placeholder:text-[#e9c665]/70 focus-visible:ring-2 focus-visible:ring-[#e9c665]/60"
            />
            {lesson.code.after}
          </code>
        </pre>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={check}
            className="rounded-md bg-white px-3 py-1.5 text-sm font-medium text-black transition-colors hover:bg-white/90"
          >
            Check
          </button>
          {tries >= 2 && verdict !== "correct" && (
            <button
              type="button"
              onClick={() => {
                setValue(lesson.yourTurn.reveal);
                setVerdict("correct");
              }}
              className="text-sm text-white/60 underline underline-offset-4 hover:text-white"
            >
              Show the answer
            </button>
          )}
        </div>
        <p role="status" aria-live="polite" className="mt-3 min-h-6 text-sm" data-gap-verdict={verdict ?? ""}>
          {verdict === "correct" && (
            <span className="flex items-center gap-2 text-emerald-300">
              <CheckIcon aria-hidden="true" className="size-4" /> {lesson.yourTurn.correct}
            </span>
          )}
          {verdict === "partial" && <span className={GOLD}>{lesson.yourTurn.partial}</span>}
          {verdict === "incorrect" && <span className="text-rose-300">{lesson.yourTurn.incorrect}</span>}
        </p>
      </section>
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
