/**
 * Demo content for the landing: one lesson from the "Containers handbook"
 * written to the Master-mode contracts (#23 lesson content, #24 quiz) so the preview
 * matches what the product will generate. Graded entirely in the browser.
 */

export type DemoQuizQuestion = {
  id: string;
  stem: string;
  options: { id: string; text: string }[];
  correct: string;
  /** Explanation for each wrong option, plus the correct one. */
  explanations: Record<string, string>;
};

export type OrderVerdict = "correct" | "partial" | "incorrect";

export const demoLesson = {
  number: 4,
  total: 9,
  title: "Pods",
  module: "Deploy",
  minutes: 5,
  label: "Demo lesson · graded in your browser",
  objective:
    "Explain what a Pod is and why Kubernetes schedules Pods rather than containers.",
  explanation: [
    "A Pod is the smallest thing Kubernetes schedules. It wraps one or more containers that run together on one node, share a network namespace and reach each other over localhost.",
    "Kubernetes never schedules a bare container. You describe the Pod, its images, ports and volumes, and the scheduler finds a node with room for the whole set. If the node dies, the Pod dies with it.",
    "Most Pods hold one container; add a second only for a helper that must live beside the main process, like a log shipper. Keep containers stateless and mount a volume for data that must persist.",
  ],
  insight: {
    kind: "Common misconception",
    text: "A Pod is not a bigger container. It is the unit of scheduling and networking; the containers inside stay separate processes with separate images.",
  },
  sources: [
    "A Pod runs one or more containers together.",
    "Tag images with a version before you push them.",
    "Keep containers stateless; mount volumes for data.",
  ],
  order: {
    prompt: "Put these in the order they happen when a Pod starts.",
    /** Correct order. The card first shows them in `start` order. */
    steps: [
      { id: "describe", text: "You describe the Pod: images, ports, volumes." },
      { id: "schedule", text: "The scheduler places the whole Pod on one node." },
      { id: "start", text: "The node pulls the images and starts the containers together." },
      { id: "network", text: "Once running, the containers talk over localhost using their shared network namespace." },
    ],
    start: ["start", "network", "describe", "schedule"],
    feedback: {
      correct: "That is the order: describe, schedule, start, then communicate over localhost.",
      partial: "Some steps are in place. Scheduling happens before anything is pulled or started.",
      incorrect: "Start from what you do: you describe the Pod before Kubernetes does anything with it.",
    },
  },
  quizBanks: [
    [
      {
        id: "a1",
        stem: "What does a Pod represent in Kubernetes?",
        options: [
          { id: "a", text: "A single container only" },
          { id: "b", text: "One or more containers scheduled together" },
          { id: "c", text: "A node in the cluster" },
          { id: "d", text: "A persistent volume" },
        ],
        correct: "b",
        explanations: {
          a: "A Pod can hold one container, but it may hold several that must run together.",
          b: "The Pod is the unit the scheduler places; its containers share a node and a network namespace.",
          c: "Nodes are machines; Pods run on them.",
          d: "Volumes are mounted into Pods; they are not Pods.",
        },
      },
      {
        id: "a2",
        stem: "Why tag the image used by a Pod's container?",
        options: [
          { id: "a", text: "Tags make the image smaller" },
          { id: "b", text: "Untagged images resolve to :latest, which can differ between nodes" },
          { id: "c", text: "Kubernetes refuses untagged images" },
          { id: "d", text: "Tags enable port mapping" },
        ],
        correct: "b",
        explanations: {
          a: "A tag is a name for a version; it does not change the image size.",
          b: "Pinning a tag means every node pulls the same bytes.",
          c: "Kubernetes accepts untagged images; it silently assumes :latest.",
          d: "Ports are declared in the Pod spec, independent of tags.",
        },
      },
      {
        id: "a3",
        stem: "Containers in the same Pod share…",
        options: [
          { id: "a", text: "one network namespace, reachable over localhost" },
          { id: "b", text: "nothing; they are fully isolated" },
          { id: "c", text: "the same image" },
          { id: "d", text: "the node's root filesystem" },
        ],
        correct: "a",
        explanations: {
          a: "Same node, same IP, same network namespace.",
          b: "They are separate processes but share networking and can share volumes.",
          c: "Each container runs its own image.",
          d: "Containers see their own filesystems plus any mounted volumes.",
        },
      },
    ],
    [
      {
        id: "b1",
        stem: "Which object does the scheduler place onto a node?",
        options: [
          { id: "a", text: "Container" },
          { id: "b", text: "Pod" },
          { id: "c", text: "Service" },
          { id: "d", text: "Image" },
        ],
        correct: "b",
        explanations: {
          a: "Containers are never scheduled on their own; they live inside a Pod.",
          b: "The Pod is the unit of scheduling.",
          c: "A Service gives Pods a stable address; it is not scheduled.",
          d: "Images are pulled by nodes; they are not scheduled.",
        },
      },
      {
        id: "b2",
        stem: "Containers in one Pod can share files through…",
        options: [
          { id: "a", text: "a volume mounted into both" },
          { id: "b", text: "environment variables only" },
          { id: "c", text: "the image layers" },
          { id: "d", text: "the Service address" },
        ],
        correct: "a",
        explanations: {
          a: "A Pod-level volume can be mounted by each container.",
          b: "Environment variables carry values, not files.",
          c: "Image layers are read-only and per container.",
          d: "A Service is a network address, not storage.",
        },
      },
      {
        id: "b3",
        stem: "If nothing manages a Pod and its node fails, the Pod…",
        options: [
          { id: "a", text: "is recreated automatically" },
          { id: "b", text: "is lost; a Deployment is needed to replace it" },
          { id: "c", text: "moves to another node by itself" },
          { id: "d", text: "becomes a Service" },
        ],
        correct: "b",
        explanations: {
          a: "Only a controller such as a Deployment recreates Pods.",
          b: "The Pod dies with its node; replicas are a Deployment's job.",
          c: "Pods do not migrate on their own.",
          d: "Services and Pods are different objects.",
        },
      },
    ],
  ] satisfies DemoQuizQuestion[][],
  passScore: 2,
};

/** Positions that match the correct order decide the verdict. */
export function gradeOrder(order: string[]): { verdict: OrderVerdict; correctPositions: number } {
  const correct = demoLesson.order.steps.map((step) => step.id);
  const correctPositions = order.filter((id, index) => id === correct[index]).length;
  const verdict: OrderVerdict =
    order.length === correct.length && correctPositions === correct.length ? "correct" : correctPositions >= 2 ? "partial" : "incorrect";
  return { verdict, correctPositions };
}

export function gradeQuiz(bank: DemoQuizQuestion[], answers: Record<string, string>) {
  const score = bank.filter((q) => answers[q.id] === q.correct).length;
  return { score, passed: score >= demoLesson.passScore };
}

/** An example week of learning, as lessons completed by the end of each day. */
export const demoWeek = [
  { day: "Mon", completed: 1 },
  { day: "Tue", completed: 2 },
  { day: "Wed", completed: 2 },
  { day: "Thu", completed: 3 },
  { day: "Fri", completed: 3 },
  { day: "Sat", completed: 3 },
  { day: "Today", completed: 3 },
];

/** Shape mirrors the planned GET /courses/{id}/progress (#26); numbers are examples. */
export function demoProgress(completed: number, quizFirstTry: boolean | null) {
  const total = demoLesson.total;
  const perModule = 3;
  const modules = ["Build", "Deploy", "Operate"].map((title, index) => {
    const done = Math.max(0, Math.min(perModule, completed - index * perModule));
    const level = done === perModule ? "Mastered" : done > 0 ? "Developing" : "Not started";
    return { title, done, level };
  });
  return {
    completed,
    total,
    percent: Math.round((completed / total) * 100),
    studyMinutes: 14 + completed * 11,
    quiz: quizFirstTry === null ? "No quiz yet" : quizFirstTry ? "3/3 first try" : "Passed on retake",
    modules,
  };
}

// ---------------------------------------------------------------------------
// Scripted Ask runs over the same handbook. Step labels and outcomes are the
// product's own (core/chat/progress.ts); timings are illustrative. No model calls.

import type { ChatStep } from "@/core/chat/types";

export type DemoRun = {
  label: string;
  question: string;
  passages: { text: string; module: string; cite?: number }[];
  timeline: { at: number; step: ChatStep }[];
  answerAt: number;
  /** Answer text with [n] citation markers. */
  answer: string;
  citations: { n: number; passage: string; module: string }[];
};

const step = (
  id: string,
  kind: ChatStep["kind"],
  label: string,
  status: ChatStep["status"],
  results?: string[],
  parent?: string,
): ChatStep => ({ id, kind, label, status, results, parent });

export const DEMO_SOURCE = "Containers handbook.pdf";
export const ANSWER_CHAR_MS = 14;

export const demoRuns: DemoRun[] = [
  {
    label: "Ask a definition",
    question: "What is a Pod?",
    passages: [
      { text: "A Pod runs one or more containers together.", module: "Deploy", cite: 1 },
      { text: "Tag images with a version before you push them.", module: "Build" },
      { text: "Keep containers stateless; mount volumes for data.", module: "Build", cite: 2 },
    ],
    timeline: [
      { at: 0, step: step("triage", "search", "Choosing how to handle your question", "active") },
      { at: 650, step: step("triage", "search", "Request routed", "complete", ["Direct document search"]) },
      { at: 700, step: step("retrieve", "search", "Searching selected documents", "active") },
      { at: 1600, step: step("retrieve", "search", "Document search finished", "complete", ["Evidence retrieved", "2 evidence items"]) },
      { at: 1650, step: step("assess", "search", "Checking document evidence coverage", "active") },
      { at: 2400, step: step("assess", "search", "Document evidence checked", "complete", ["Sufficient evidence"]) },
      { at: 2450, step: step("answer", "write", "Preparing the answer", "active") },
    ],
    answerAt: 2700,
    answer:
      "A Pod is the unit Kubernetes schedules: one or more containers that run together on the same node and share networking [1]. Keep those containers stateless and mount a volume for anything that must persist [2].",
    citations: [
      { n: 1, passage: "A Pod runs one or more containers together.", module: "Deploy" },
      { n: 2, passage: "Keep containers stateless; mount volumes for data.", module: "Build" },
    ],
  },
  {
    label: "Connect two ideas",
    question: "Why do my Pods disappear when a node fails?",
    passages: [
      { text: "A Pod runs one or more containers together.", module: "Deploy" },
      { text: "Deployments keep the desired replica count running.", module: "Deploy", cite: 1 },
      { text: "Services give Pods a stable network address.", module: "Deploy", cite: 2 },
    ],
    timeline: [
      { at: 0, step: step("triage", "search", "Choosing how to handle your question", "active") },
      { at: 650, step: step("triage", "search", "Request routed", "complete", ["Multi-question research"]) },
      { at: 700, step: step("plan", "search", "Preparing research questions", "active") },
      { at: 1450, step: step("plan", "search", "Search planned", "complete", ["2 research tasks"]) },
      { at: 1500, step: step("retrieve", "search", "Searching selected documents", "active") },
      { at: 1500, step: step("retrieve:q1", "search", "Document search 1", "active", undefined, "retrieve") },
      { at: 1550, step: step("retrieve:q2", "search", "Document search 2", "active", undefined, "retrieve") },
      { at: 2300, step: step("retrieve:q1", "search", "Document search 1", "complete", ["Evidence retrieved", "1 evidence items"], "retrieve") },
      { at: 2500, step: step("retrieve:q2", "search", "Document search 2", "complete", ["Evidence retrieved", "1 evidence items"], "retrieve") },
      { at: 2550, step: step("retrieve", "search", "Document search finished", "complete") },
      { at: 2600, step: step("assess", "search", "Checking document evidence coverage", "active") },
      { at: 3300, step: step("assess", "search", "Document evidence checked", "complete", ["Sufficient evidence"]) },
      { at: 3350, step: step("answer", "write", "Preparing the answer", "active") },
    ],
    answerAt: 3600,
    answer:
      "On its own, a Pod is not replaced when its node fails. Put it under a Deployment, which keeps the desired replica count running by creating new Pods [1], and front them with a Service so the replacements keep a stable address [2].",
    citations: [
      { n: 1, passage: "Deployments keep the desired replica count running.", module: "Deploy" },
      { n: 2, passage: "Services give Pods a stable network address.", module: "Deploy" },
    ],
  },
  {
    label: "Know what's missing",
    question: "How much CPU should I request?",
    passages: [
      { text: "Set resource requests and limits on every container.", module: "Operate", cite: 1 },
      { text: "Readiness probes gate traffic until the app is up.", module: "Operate" },
      { text: "Roll back a failed rollout with kubectl rollout undo.", module: "Operate" },
    ],
    timeline: [
      { at: 0, step: step("triage", "search", "Choosing how to handle your question", "active") },
      { at: 650, step: step("triage", "search", "Request routed", "complete", ["Direct document search"]) },
      { at: 700, step: step("retrieve", "search", "Searching selected documents", "active") },
      { at: 1600, step: step("retrieve", "search", "Document search finished", "complete", ["Evidence retrieved", "1 evidence items"]) },
      { at: 1650, step: step("assess", "search", "Checking document evidence coverage", "active") },
      { at: 2400, step: step("assess", "search", "Document evidence checked", "complete", ["Partial evidence"]) },
      { at: 2450, step: step("web", "fetch", "Web research finished", "complete", ["Unavailable"]) },
      { at: 2500, step: step("answer", "write", "Preparing the answer", "active") },
    ],
    answerAt: 2750,
    answer:
      "The handbook says to set resource requests and limits on every container [1], but it gives no figures. Nothing in the selected pages supports a specific value; measure usage under a readiness-gated rollout and tune from there.",
    citations: [
      { n: 1, passage: "Set resource requests and limits on every container.", module: "Operate" },
    ],
  },
];

/** Steps visible at `elapsed` ms; the answer step completes once its text has streamed. */
export function stepsAt(run: DemoRun, elapsed: number): ChatStep[] {
  const byId = new Map<string, ChatStep>();
  for (const entry of run.timeline) if (entry.at <= elapsed) byId.set(entry.step.id, entry.step);
  if (answerCharsAt(run, elapsed) >= run.answer.length) {
    byId.set("answer", step("answer", "write", "Answer prepared", "complete"));
  }
  return [...byId.values()];
}

export function answerCharsAt(run: DemoRun, elapsed: number): number {
  return Math.max(0, Math.min(run.answer.length, Math.floor((elapsed - run.answerAt) / ANSWER_CHAR_MS)));
}

export function runDurationMs(run: DemoRun): number {
  return run.answerAt + run.answer.length * ANSWER_CHAR_MS + 400;
}
