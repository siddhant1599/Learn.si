import {
  SearchIcon,
  CompassIcon,
  GraduationCapIcon,
  type LucideIcon,
  MicroscopeIcon,
  PenLineIcon,
  ShapesIcon,
} from "lucide-react";

/** Brand and capability copy for the Study Buddy frontend. */

export type ChatSuggestion = {
  label: string;
  prompt: string;
  icon: LucideIcon;
};

export const site = {
  name: "Study Buddy",
  /** Shown when the sidebar is collapsed to its icon rail. */
  shortName: "SB",
  description:
    "Learn from your documents: ask questions with evidence, or master them lesson by lesson.",
  /** The single landing entry point; the workspace lets you choose a mode. */
  repositoryUrl: "/workspace",
  /** The SVG silhouette the landing hero's flickering grid is masked to. */
  logoMaskUrl: "/images/landing-logo-mask.svg",

  header: {
    links: [
      { href: "/workspace", label: "Workspace" },
      { href: "/docs", label: "Docs" },
    ],
    ctaLabel: "Open workspace",
  },

  hero: {
    title: "Study Buddy",
    rotatingWords: [
      "Ask anything",
      "Understand deeply",
      "Build mastery",
      "Learn from your sources",
    ],
    rotatingSuffix: "",
    description:
      "A learning workspace with your documents. Ask a question and follow the answer back to its source, or turn a document into short lessons, quizzes and a path to mastery.",
    ctaLabel: "Start learning",
    ctaHref: "/workspace",
  },

  /** Scroll stage after the examples: a synthetic page becomes a map of lessons. */
  constellation: {
    eyebrow: "Master mode · in development",
    title: "From a page to a path",
    subtitle:
      "Scroll: a document's sentences become short lessons, grouped into modules, unlocked one quiz at a time.",
    source: "Containers handbook.pdf · Page 12",
    caption:
      "A document's sentences become a map of lessons: the first module mastered, the next lesson open, the rest locked until its quiz is passed.",
    modules: ["Build", "Deploy", "Operate"],
    stars: [
      {
        sentence: "A Dockerfile declares each layer of your image.",
        label: "Dockerfile layers",
        module: 0,
      },
      {
        sentence: "Tag images with a version before you push them.",
        label: "Image tagging",
        module: 0,
      },
      {
        sentence: "Keep containers stateless; mount volumes for data.",
        label: "Volumes and state",
        module: 0,
      },
      {
        sentence: "A Pod runs one or more containers together.",
        label: "Pods",
        module: 1,
      },
      {
        sentence: "Deployments keep the desired replica count running.",
        label: "Deployments",
        module: 1,
      },
      {
        sentence: "Services give Pods a stable network address.",
        label: "Services",
        module: 1,
      },
      {
        sentence: "Set resource requests and limits on every container.",
        label: "Requests and limits",
        module: 2,
      },
      {
        sentence: "Readiness probes gate traffic until the app is up.",
        label: "Health probes",
        module: 2,
      },
      {
        sentence: "Roll back a failed rollout with kubectl rollout undo.",
        label: "Rollbacks",
        module: 2,
      },
    ],
    /** Act three: lesson states shown on the map. */
    states: {
      mastered: "Mastered",
      available: "Next lesson",
      locked: "Locked until the quiz before it is passed",
    },
    nextLesson: "Lesson 4 · ≈ 5 min",
  },

  whatsNew: {
    title: "Two ways to learn from what you have",
    subtitle:
      "Ask mode answers with evidence. Master mode turns a document into lessons, quizzes and progress.",
    features: [
      {
        label: "Ask mode",
        title: "Get answers. Understand anything.",
        description:
          "Upload PDF, TXT or Markdown, select up to five sources and ask. Answers stay grounded in your documents, with citations beside them.",
      },
      {
        label: "Agentic retrieval",
        title: "Break down complex questions",
        description:
          "Simple questions go straight to document search. Complex questions are split into smaller ones, with independent searches running together and evidence checked before the answer.",
      },
      {
        label: "Evidence",
        title: "Sources beside answers",
        description:
          "Document titles, editions, section references and page numbers sit next to every citation. When document evidence is insufficient, separately labeled web findings fill the gap.",
      },
      {
        label: "Master mode",
        title: "Learn deeply. Build mastery.",
        description:
          "Turn a document into a lesson plan of modules and short lessons, each with an example, a diagram and a tutor that guides your thinking. In development.",
      },
      {
        label: "Quizzes",
        title: "Check understanding as you go",
        description:
          "Every lesson ends with a short quiz that explains wrong answers. Passing unlocks the next lesson; retakes bring fresh questions. In development.",
      },
      {
        label: "Progress",
        title: "See your mastery grow",
        description:
          "Follow course progress, lesson completion, quiz performance, topic mastery and study time in one place. In development.",
      },
    ],
  },

  footer: {
    quote: "Understand what you read. Remember what you learn.",
  },

  chat: {
    greeting: "What would you like to understand?",
    description: "Select documents and ask a question.",
    placeholder: "Ask a question about your documents…",
    disclaimer: "Answers can make mistakes. Check the cited sources.",
    surpriseMe: {
      label: "Demo question",
      prompt: "What must archive labels contain?",
    },
    createLabel: "Explore",
    suggestions: [
      {
        label: "Summarize",
        prompt: "Summarize the main points about [topic] in my documents",
        icon: PenLineIcon,
      },
      {
        label: "Research",
        prompt: "Find the requirements for [topic] in my documents.",
        icon: MicroscopeIcon,
      },
      {
        label: "Compare",
        prompt: "Compare what my selected documents say about [topic].",
        icon: ShapesIcon,
      },
      {
        label: "Learn",
        prompt: "Explain [topic] using my selected documents.",
        icon: GraduationCapIcon,
      },
    ] satisfies ChatSuggestion[],
    createSuggestions: [
      {
        label: "Find exceptions",
        prompt: "What exceptions do these documents mention?",
        icon: SearchIcon,
      },
      {
        label: "Next steps",
        prompt: "Which instructions should I follow first?",
        icon: CompassIcon,
      },
    ] satisfies ChatSuggestion[],
    models: [{ name: "default", displayName: "Configured OpenRouter model" }],
  },
};
