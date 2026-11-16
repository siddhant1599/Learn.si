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
  /** Source repository; all learning CTAs still lead to the mode chooser. */
  repositoryUrl: "https://github.com/code-bot-sid/Document-Lab",
  /** The SVG silhouette the landing hero's flickering grid is masked to. */
  logoMaskUrl: "/images/landing-logo-mask.svg",

  header: {
    links: [
      { href: "/workspace", label: "Workspace" },
      { href: "/docs", label: "Docs" },
    ],
    ctaLabel: "Star on GitHub",
  },

  hero: {
    title: "Study Buddy",
    /** One phrase per capability, each read in front of the fixed noun below. */
    rotatingWords: [
      "Personal Learning",
      "Document Research",
      "Lesson Planning",
      "Quiz Coaching",
    ],
    rotatingSuffix: "SuperAgent",
    description:
      "A learning workspace with your documents. Ask a question and follow the answer back to its source, or turn a document into short lessons, quizzes and a path to mastery.",
    ctaLabel: "Start learning",
    ctaHref: "/workspace",
  },

  /** The demo course shown in the landing's lesson tree: three modules of three lessons. */
  course: {
    modules: ["Build", "Deploy", "Operate"],
    lessons: [
      { label: "Dockerfile layers", module: 0 },
      { label: "Image tagging", module: 0 },
      { label: "Volumes and state", module: 0 },
      { label: "Pods", module: 1 },
      { label: "Deployments", module: 1 },
      { label: "Services", module: 1 },
      { label: "Requests and limits", module: 2 },
      { label: "Health probes", module: 2 },
      { label: "Rollbacks", module: 2 },
    ],
  },

  whatsNew: {
    title: "Agents that help you learn",
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
          "Turn a document into a lesson plan of modules and short lessons, each with an example, a diagram, a Your turn exercise and a tutor that guides your thinking before giving answers.",
      },
      {
        label: "Quizzes",
        title: "Check understanding as you go",
        description:
          "Every lesson ends with a three-question quiz that explains wrong answers. Two of three unlocks the next lesson; retakes bring fresh questions.",
      },
      {
        label: "Progress",
        title: "See your mastery grow",
        description:
          "Follow course progress, lesson completion, quiz performance, topic mastery and study time in one place. Estimates inform; nothing is timed.",
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
