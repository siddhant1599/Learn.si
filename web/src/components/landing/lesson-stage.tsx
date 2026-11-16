"use client";

import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  FileText,
  Folder,
  Sparkles,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useId, useState } from "react";

import { site } from "@/config/site";
import {
  demoLesson,
  demoProgress,
  demoWeek,
  gradeOrder,
  gradeQuiz,
  type DemoQuizQuestion,
  type OrderVerdict,
} from "@/content/landing-demo";
import { usePrefersReducedMotion } from "@/core/dom/render-activity";
import { cn } from "@/lib/utils";

const INITIAL_COMPLETED = 3; // Module one mastered when the visitor arrives.

/**
 * Design B of "Lesson 4 · Pods" and "Your sky, filling in", for comparison with the
 * originals above: the same lesson, exercise, quiz and progress, styled like
 * frontend-sample's Agent Skills stage (a course tree beside a tutor chat).
 */
export function LessonStage() {
  const reduced = usePrefersReducedMotion();
  const [completed, setCompleted] = useState(INITIAL_COMPLETED);
  const [quizFirstTry, setQuizFirstTry] = useState<boolean | null>(null);
  const [side, setSide] = useState<"lesson" | "quiz">("lesson");
  const pass = (firstTry: boolean) => {
    setCompleted((count) => Math.max(count, INITIAL_COMPLETED + 1));
    setQuizFirstTry((value) => value ?? firstTry);
  };

  return (
    <section id="lesson-stage" aria-labelledby="lesson-stage-title" className="w-full bg-white/[0.02] py-16">
      <div className="mx-auto w-full max-w-6xl px-4">
        <p className="mb-6 text-center text-xs tracking-[0.3em] text-zinc-500 uppercase">Design B · for comparison</p>
        <h3 id="lesson-stage-title" className="mb-8 text-center font-serif text-2xl text-white sm:text-3xl">
          Open the next lesson
        </h3>
        <div className="flex flex-col gap-8 md:flex-row md:items-start">
          <ProgressTree completed={completed} quizFirstTry={quizFirstTry} reduced={reduced} />
          <div
            data-b-lesson
            data-b-side={side}
            className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/50"
          >
            <div className="flex items-center justify-between gap-3 border-b border-zinc-800 p-4">
              <div className="flex items-center gap-2">
                <span className="size-3 rounded-full bg-green-500" />
                <span className="text-sm text-zinc-400">Study Buddy Tutor · Master mode</span>
              </div>
              <span className="hidden text-xs text-zinc-500 sm:inline">{demoLesson.label}</span>
            </div>
            <div className="space-y-4 p-6">
              {reduced ? (
                side === "lesson" ? (
                  <LessonChat reduced onQuiz={() => setSide("quiz")} />
                ) : (
                  <QuizChat reduced onBack={() => setSide("lesson")} onPass={pass} passed={completed > INITIAL_COMPLETED} />
                )
              ) : (
              <AnimatePresence mode="wait" initial={false}>
                {side === "lesson" ? (
                  <motion.div key="lesson" {...fade(reduced)}>
                    <LessonChat reduced={reduced} onQuiz={() => setSide("quiz")} />
                  </motion.div>
                ) : (
                  <motion.div key="quiz" {...fade(reduced)}>
                    <QuizChat
                      reduced={reduced}
                      onBack={() => setSide("lesson")}
                      onPass={pass}
                      passed={completed > INITIAL_COMPLETED}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
              )}
            </div>
            {/* Decorative input, as in the sample. */}
            <div className="border-t border-zinc-800 p-4">
              <div className="rounded-xl bg-zinc-800 px-4 py-3 text-sm text-zinc-500">Ask the tutor about this lesson…</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function fade(reduced: boolean) {
  return reduced
    ? {}
    : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -8 }, transition: { duration: 0.25 } };
}

/** Blocks reveal one after another the first time they scroll into view. */
function Reveal({ children, index, reduced, className }: { children: React.ReactNode; index: number; reduced: boolean; className?: string }) {
  if (reduced) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.4, delay: index * 0.12 }}
    >
      {children}
    </motion.div>
  );
}

function UserBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-4 flex justify-end">
      <div className="max-w-[90%] rounded-2xl rounded-tr-sm bg-blue-600 px-5 py-3 text-base text-white">{children}</div>
    </div>
  );
}

function Block({ icon, title, children, divider = true }: { icon: string; title: React.ReactNode; children?: React.ReactNode; divider?: boolean }) {
  return (
    <div className="mt-4">
      {divider && <hr className="mb-3 border-zinc-700" />}
      <div className="mb-2 text-zinc-300">
        {icon} {title}
      </div>
      {children}
    </div>
  );
}

function LessonChat({ reduced, onQuiz }: { reduced: boolean; onQuiz: () => void }) {
  const lesson = demoLesson;
  return (
    <article>
      <Reveal index={0} reduced={reduced}>
        <UserBubble>
          Open Lesson {lesson.number} · {lesson.title}
        </UserBubble>
      </Reveal>
      <Reveal index={1} reduced={reduced}>
        <Block icon="📘" divider={false} title={<span className="text-xl font-medium text-white">Lesson {lesson.number} · {lesson.title}</span>}>
          <p className="text-sm text-zinc-400">{lesson.objective}</p>
        </Block>
      </Reveal>
      <Reveal index={2} reduced={reduced}>
        <Block icon="📖" title="Explanation">
          <div className="space-y-3 pl-4 text-[15px] leading-7 text-zinc-300">
            {lesson.explanation.map((paragraph) => (
              <p key={paragraph.slice(0, 24)}>{paragraph}</p>
            ))}
          </div>
        </Block>
      </Reveal>
      <Reveal index={3} reduced={reduced}>
        <Block icon="💡" title={`Insight · ${lesson.insight.kind}`}>
          <div role="note" className="rounded-xl border border-purple-500/30 bg-purple-500/10 p-4 text-sm leading-6 text-purple-100">
            {lesson.insight.text}
          </div>
        </Block>
      </Reveal>
      <Reveal index={4} reduced={reduced}>
        <OrderExercise />
      </Reveal>
      <Reveal index={5} reduced={reduced}>
        <Block icon="📄" title="Grounded in">
          <div className="space-y-2 pl-4">
            {lesson.sources.map((source) => (
              <div key={source} className="flex items-center gap-2 text-sm text-zinc-400">
                <FileText size={14} className="shrink-0" /> <span>“{source}”</span>
              </div>
            ))}
          </div>
        </Block>
        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={onQuiz}
            className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-all hover:bg-blue-500 active:scale-95"
          >
            Take the quiz →
          </button>
        </div>
      </Reveal>
    </article>
  );
}

const VERDICT_CARD: Record<OrderVerdict, string> = {
  correct: "border-green-500/30 bg-green-500/10 text-green-500",
  partial: "border-amber-400/30 bg-amber-400/10 text-amber-300",
  incorrect: "border-rose-400/30 bg-rose-400/10 text-rose-300",
};
const VERDICT_ICON: Record<OrderVerdict, string> = { correct: "✅", partial: "⚠️", incorrect: "❌" };

/** "Your turn": the same ordering exercise, with keyboard-friendly move buttons. */
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
  return (
    <section aria-labelledby={headingId}>
      <hr className="mt-4 mb-3 border-zinc-700" />
      <div id={headingId} className="mb-1 text-zinc-300">
        🧩 Your turn · set the order
      </div>
      <p className="mb-3 text-sm text-zinc-400">{order.prompt}</p>
      <ol className="space-y-2" aria-label="Steps in your order">
        {ids.map((id, index) => {
          const step = byId.get(id)!;
          const placed = verdict !== null && correctIds[index] === id;
          const misplaced = verdict !== null && !placed;
          return (
            <motion.li
              layout
              key={id}
              data-b-order-item={id}
              data-b-placed={verdict === null ? undefined : placed}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors",
                verdict === null && "bg-zinc-800/60 text-zinc-200",
                placed && "bg-green-500/10 text-green-400",
                misplaced && "bg-rose-400/10 text-rose-200",
              )}
            >
              <span className="w-5 shrink-0 font-mono text-xs text-zinc-500">{index + 1}.</span>
              <span className="flex-1">{step.text}</span>
              {placed && <Check size={15} aria-label="In the right place" className="shrink-0 text-green-500" />}
              <span className="flex shrink-0 gap-1">
                <MoveButton label={`Move up: ${step.text}`} disabled={index === 0 || solved} onClick={() => move(index, -1)}>
                  <ArrowUp size={14} aria-hidden="true" />
                </MoveButton>
                <MoveButton label={`Move down: ${step.text}`} disabled={index === ids.length - 1 || solved} onClick={() => move(index, 1)}>
                  <ArrowDown size={14} aria-hidden="true" />
                </MoveButton>
              </span>
            </motion.li>
          );
        })}
      </ol>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={solved}
          onClick={() => {
            setVerdict(gradeOrder(ids).verdict);
            setTries((n) => n + 1);
          }}
          className="rounded-xl bg-zinc-700 px-4 py-2 text-sm font-medium text-white transition-all hover:bg-zinc-600 active:scale-95 disabled:opacity-50"
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
            className="text-sm text-zinc-400 underline underline-offset-4 hover:text-white"
          >
            Show the order
          </button>
        )}
      </div>
      <div role="status" aria-live="polite" data-b-order-verdict={verdict ?? ""}>
        <AnimatePresence>
          {verdict && (
            <motion.div
              key={`${verdict}-${tries}`}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className={cn("mt-3 rounded-xl border p-3 text-sm font-medium", VERDICT_CARD[verdict])}
            >
              {VERDICT_ICON[verdict]} {order.feedback[verdict]}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}

function MoveButton({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-7 items-center justify-center rounded-full bg-white/10 text-white transition-all hover:scale-110 hover:bg-white/20 active:scale-95 disabled:cursor-not-allowed disabled:opacity-25 disabled:hover:scale-100"
    >
      {children}
    </button>
  );
}

function QuizChat({
  reduced,
  onBack,
  onPass,
  passed,
}: {
  reduced: boolean;
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
  return (
    <div data-b-quiz data-b-attempt={attempt + 1}>
      <UserBubble>Take the quiz</UserBubble>
      <Block icon="📝" divider={false} title={<span className="text-xl font-medium text-white">Check your understanding</span>}>
        <p className="text-xs tracking-widest text-zinc-500 uppercase">
          Quiz · Lesson {demoLesson.number} · attempt {attempt + 1}
        </p>
        <p className="mt-2 text-sm text-zinc-400">
          Three questions. Pass {demoLesson.passScore} of 3 to unlock the next lesson; a retake brings new questions.
        </p>
      </Block>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (complete && !result) submit();
        }}
      >
        {bank.map((question, index) => (
          <motion.div
            key={question.id}
            initial={reduced ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
          >
            <Question
              index={index}
              question={question}
              chosen={answers[question.id]}
              locked={result !== null}
              onChoose={(id) => setAnswers((current) => ({ ...current, [question.id]: id }))}
            />
          </motion.div>
        ))}
        {!result && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-zinc-500">{Object.keys(answers).length} of 3 answered</p>
            <button
              type="submit"
              disabled={!complete}
              className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-all hover:bg-blue-500 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Submit answers
            </button>
          </div>
        )}
      </form>
      {result && (
        <motion.div
          initial={reduced ? false : { opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          role="status"
          aria-live="polite"
          data-b-quiz-result={result.passed ? "passed" : "failed"}
          className={cn(
            "mt-4 rounded-xl border p-4",
            result.passed ? "border-green-500/30 bg-green-500/10" : "border-amber-400/30 bg-amber-400/10",
          )}
        >
          <p className={cn("text-lg font-medium", result.passed ? "text-green-500" : "text-amber-300")}>
            {result.passed ? "✅" : "⚠️"} {result.score}/3 · {result.passed ? "Passed" : "Not passed yet"}
          </p>
          <p className="mt-1 text-sm text-zinc-300">
            {result.passed
              ? "Lesson 4 is complete. In the course tree, Pods turns green and Deployments opens."
              : `You need ${demoLesson.passScore} of 3. Retake with a fresh set of questions.`}
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            {!result.passed && (
              <button
                type="button"
                onClick={() => {
                  setAttempt((n) => n + 1);
                  setAnswers({});
                  setResult(null);
                }}
                className="rounded-xl bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500"
              >
                Retake with new questions
              </button>
            )}
            <BackButton onBack={onBack} />
          </div>
        </motion.div>
      )}
      {!result && (
        <div className="mt-4">
          <BackButton onBack={onBack} />
        </div>
      )}
      {passed && !result && <p className="mt-3 text-xs text-zinc-500">You already passed this quiz; retaking does not change your progress.</p>}
    </div>
  );
}

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <button
      type="button"
      onClick={onBack}
      className="flex items-center gap-2 rounded-xl bg-white/10 px-3 py-1.5 text-sm text-white transition-all hover:bg-white/20"
    >
      <ArrowLeft size={14} aria-hidden="true" /> Back to the lesson
    </button>
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
  return (
    <fieldset className="mt-4" data-b-question={question.id}>
      <hr className="mb-3 border-zinc-700" />
      <legend className="sr-only">
        {index + 1}. {question.stem}
      </legend>
      <p aria-hidden="true" className="mb-2 text-zinc-200">
        {index + 1}. {question.stem}
      </p>
      <div className="space-y-2 pl-4">
        {question.options.map((option) => {
          const isChosen = chosen === option.id;
          const isCorrect = option.id === question.correct;
          const showState = locked && (isChosen || isCorrect);
          return (
            <label
              key={option.id}
              className={cn(
                "flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors",
                !locked && !isChosen && "bg-zinc-800/60 text-zinc-300 hover:bg-zinc-800",
                !locked && isChosen && "bg-blue-600/20 text-white ring-1 ring-blue-500/60",
                showState && isCorrect && "bg-green-500/10 text-green-400",
                showState && isChosen && !isCorrect && "bg-rose-400/10 text-rose-300",
                locked && !showState && "bg-zinc-800/40 text-zinc-500",
              )}
            >
              <input
                type="radio"
                name={`demo-b-${question.id}`}
                value={option.id}
                checked={isChosen}
                disabled={locked}
                onChange={() => onChoose(option.id)}
                className="size-3.5 accent-blue-500"
              />
              <span className="flex-1">{option.text}</span>
              {showState && isCorrect && <Check size={15} aria-label="Correct answer" className="text-green-500" />}
              {showState && isChosen && !isCorrect && <X size={15} aria-label="Your answer" className="text-rose-300" />}
            </label>
          );
        })}
      </div>
      {locked && chosen && (
        <p className="mt-2 pl-4 text-xs leading-5 text-zinc-400">
          {chosen !== question.correct && <>{question.explanations[chosen]} </>}
          <span className="text-zinc-200">{question.explanations[question.correct]}</span>
        </p>
      )}
    </fieldset>
  );
}

type LessonState = "mastered" | "next" | "locked";

const LESSON_CLASS: Record<LessonState, string> = {
  mastered: "text-green-500",
  next: "text-white",
  locked: "text-zinc-600",
};

/** "Your sky, filling in" as the sample's file tree: modules are folders, lessons are files. */
function ProgressTree({ completed, quizFirstTry, reduced }: { completed: number; quizFirstTry: boolean | null; reduced: boolean }) {
  const [day, setDay] = useState(demoWeek.length - 1);
  const sliderId = useId();
  const isToday = day === demoWeek.length - 1;
  const shown = isToday ? completed : Math.min(demoWeek[day]!.completed, completed);
  const progress = demoProgress(shown, isToday ? quizFirstTry : null);
  const stars = site.constellation.stars;
  const stateOf = (index: number): LessonState => (index < shown ? "mastered" : index === shown ? "next" : "locked");

  return (
    <section aria-labelledby={`${sliderId}-title`} data-b-progress data-b-completed={shown} className="flex flex-col md:w-[42%]">
      <div className="mb-1 font-mono text-sm text-zinc-500">/courses/containers-handbook/</div>
      <p className="text-xs tracking-widest text-zinc-500 uppercase">Progress · example week</p>
      <h3 id={`${sliderId}-title`} className="mt-2 text-2xl font-medium text-white">
        Your sky, filling in
      </h3>
      <p className="mt-2 mb-5 text-sm text-zinc-400">
        Each lesson is a star. Green is mastered, white is open, dim is still locked.
      </p>

      <div className="space-y-2" role="list" aria-label={`${shown} of ${stars.length} lessons complete`}>
        {site.constellation.modules.map((module, moduleIndex) => {
          const lessons = stars.map((star, index) => ({ ...star, index })).filter((star) => star.module === moduleIndex);
          const states = lessons.map((lesson) => stateOf(lesson.index));
          const folder: LessonState = states.every((s) => s === "mastered") ? "mastered" : states.includes("next") || states.includes("mastered") ? "next" : "locked";
          return (
            <div key={module} role="listitem">
              <div className={cn("flex items-center gap-3 text-lg font-medium transition-colors duration-300", LESSON_CLASS[folder])}>
                <Folder size={20} className="shrink-0" />
                <span>{module}</span>
                {folder === "mastered" && <Check size={16} className="text-green-500" />}
              </div>
              <ul className="mt-1 space-y-1.5">
                {lessons.map((lesson) => {
                  const state = stateOf(lesson.index);
                  return (
                    <motion.li
                      key={lesson.label}
                      data-b-lesson-state={state}
                      animate={reduced ? undefined : state === "mastered" ? { scale: [1, 1.04, 1] } : { scale: 1 }}
                      transition={{ duration: 0.5 }}
                      className={cn(
                        "flex items-center gap-3 pl-6 text-base font-medium transition-all duration-300 motion-reduce:transition-none",
                        LESSON_CLASS[state],
                        state === "next" && "translate-x-2",
                      )}
                    >
                      <FileText size={18} className="shrink-0" />
                      <span>
                        Lesson {lesson.index + 1} · {lesson.label}
                      </span>
                      {state === "mastered" && <Check size={15} className="text-green-500" aria-label="Mastered" />}
                      {state === "next" && (
                        <span className="flex items-center gap-1 text-xs text-purple-400">
                          <Sparkles size={14} /> Next
                        </span>
                      )}
                    </motion.li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-3 text-sm">
        <Stat label="Lessons" value={`${progress.completed}/${progress.total}`} />
        <Stat label="Course" value={`${progress.percent}%`} />
        <Stat label="Study time" value={formatMinutes(progress.studyMinutes)} />
        <Stat label="Quiz" value={progress.quiz} />
      </dl>
      <ul className="mt-4 flex flex-wrap gap-2">
        {progress.modules.map((module) => (
          <li
            key={module.title}
            className={cn(
              "rounded-full px-3 py-1 text-xs",
              module.level === "Mastered" ? "bg-green-500/10 text-green-500" : module.level === "Developing" ? "bg-white/10 text-white" : "bg-white/5 text-zinc-500",
            )}
          >
            {module.title} · {module.level}
          </li>
        ))}
      </ul>

      <div className="mt-6">
        <div className="flex items-center justify-between text-xs text-zinc-400">
          <label htmlFor={sliderId}>Replay the week</label>
          <span aria-live="polite">{demoWeek[day]!.day}</span>
        </div>
        <input
          id={sliderId}
          type="range"
          min={0}
          max={demoWeek.length - 1}
          value={day}
          onChange={(event) => setDay(Number(event.target.value))}
          className="mt-2 w-full accent-blue-500"
        />
        <div className="mt-1 flex justify-between text-[10px] tracking-wide text-zinc-600 uppercase">
          {demoWeek.map((entry) => (
            <span key={entry.day}>{entry.day === "Today" ? "Now" : entry.day}</span>
          ))}
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3">
      <dt className="text-[11px] tracking-wide text-zinc-500 uppercase">{label}</dt>
      <dd className="mt-1 font-medium text-white">{value}</dd>
    </div>
  );
}

function formatMinutes(total: number) {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return hours ? `${hours} h ${minutes} min` : `${minutes} min`;
}
