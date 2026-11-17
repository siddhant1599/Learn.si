import type { ChatThread, Citation } from "./types";

export function safeWebUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return ["https:", "http:"].includes(u.protocol) && !u.username && !u.password
      && !/[\s\\]/.test(value);
  } catch { return false; }
}

/** Raw source payloads are never part of a saved citation, for documents or the web. */
const RAW_SOURCE_FIELDS = ["text", "excerpt"];
function savedCitations(citations?: Citation[]): Citation[] | undefined {
  return citations?.map(c =>
    Object.fromEntries(Object.entries(c).filter(([k]) => !RAW_SOURCE_FIELDS.includes(k))) as Citation);
}

/**
 * Build the browser-storage copy of a chat; never mutate the live thread. Web answers,
 * their "From the web" section and source links are kept, so a reload shows the same
 * answer. Activity details stay transient: only each step's identity and lifecycle are kept.
 */
export function persistedThread(thread: ChatThread): ChatThread {
  return {
    ...thread,
    messages: thread.messages.map(message => {
      if (message.role === "user") return message;
      // persistedAnswer / persistedCitations: older builds' stripped copies, no longer used.
      const { persistedAnswer: _answer, persistedCitations: _citations, ...rest } = message;
      return {
        ...rest,
        citations: savedCitations(message.citations),
        steps: message.steps.map(s => s.progressVersion === 1 ? {
          id: s.id, kind: s.kind, label: s.label, status: s.status,
          progressVersion: 1 as const, attempt: s.attempt, sequence: s.sequence, parent: s.parent,
        } : s),
      };
    }),
  };
}
