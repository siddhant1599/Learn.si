/**
 * Synthetic demo content for the landing: one lesson from the "Containers handbook"
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

export type GapVerdict = "correct" | "partial" | "incorrect";

export const demoLesson = {
  number: 4,
  total: 9,
  title: "Pods",
  module: "Deploy",
  minutes: 5,
  label: "Demo lesson · synthetic handbook · graded in your browser",
  objective:
    "Explain what a Pod is and why Kubernetes schedules Pods rather than containers.",
  explanation: [
    "A Pod is the smallest thing Kubernetes schedules. It wraps one or more containers that must run together: they start on the same node, share one network namespace, and can reach each other over localhost. Each Pod gets its own IP address inside the cluster. Most Pods hold a single container; a second one appears when something must sit beside the main process, such as a log shipper, a proxy or a config reloader.",
    "Because the Pod is the unit, Kubernetes never schedules a bare container. You describe the Pod, which images to run, which ports to expose, which volumes to mount, and the scheduler finds a node with room for the whole set. If the node dies, the Pod dies with it; keeping replicas alive is the job of a Deployment, which is the next lesson.",
    "Two habits keep Pods predictable. Pin every image to a tag so each node pulls the same bytes, and keep containers stateless, mounting a volume for anything that must outlive a restart.",
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
  code: {
    language: "yaml",
    before: "apiVersion: v1\nkind: Pod\nmetadata:\n  name: web\nspec:\n  containers:\n    - name: web\n      image: ",
    after: "\n      ports:\n        - containerPort: 80",
    placeholder: "TODO(you)",
    instruction: "Fill in the image for the web container. Use a tagged image.",
  },
  yourTurn: {
    correct: "Tagged image: every node pulls exactly that version.",
    partial:
      "That is an image, but without a tag Kubernetes pulls :latest, which can differ between nodes. Add a tag.",
    incorrect:
      "The value should be an image reference such as name:tag. Re-read the paragraph on pinning images.",
    reveal: "nginx:1.27",
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

/** Image reference checks for the TODO(you) gap. */
export function gradeImage(value: string): GapVerdict {
  const trimmed = value.trim();
  if (/^(?:[a-z0-9.-]+(?::\d+)?\/)?[a-z0-9._/-]+:[\w.-]+$/i.test(trimmed)) return "correct";
  if (/^(?:[a-z0-9.-]+(?::\d+)?\/)?[a-z0-9._/-]+$/i.test(trimmed)) return "partial";
  return "incorrect";
}

export function gradeQuiz(bank: DemoQuizQuestion[], answers: Record<string, string>) {
  const score = bank.filter((q) => answers[q.id] === q.correct).length;
  return { score, passed: score >= demoLesson.passScore };
}

/** A synthetic week of learning, as lessons completed by the end of each day. */
export const demoWeek = [
  { day: "Mon", completed: 1 },
  { day: "Tue", completed: 2 },
  { day: "Wed", completed: 2 },
  { day: "Thu", completed: 3 },
  { day: "Fri", completed: 3 },
  { day: "Sat", completed: 3 },
  { day: "Today", completed: 3 },
];

/** Shape mirrors the planned GET /courses/{id}/progress (#26); numbers are synthetic. */
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
