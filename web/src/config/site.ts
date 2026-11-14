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
  /** The SVG silhouette the hero's flickering grid is masked to. */
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
      "A learning workspace for your documents. Ask a question and follow the answer back to its source, or turn a document into short lessons, quizzes and a path to mastery.",
    ctaLabel: "Start learning",
    ctaHref: "/workspace",
  },

  whatsNew: {
    title: "Two ways to learn from what you have",
    subtitle:
      "Ask mode answers with evidence. Master mode turns a document into lessons, quizzes and progress.",
    features: [
      {
        label: "Ask · Mode 01",
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
        label: "Master · Mode 02",
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
    placeholderNav: [] as { label: string; icon: LucideIcon }[],
  },
};
