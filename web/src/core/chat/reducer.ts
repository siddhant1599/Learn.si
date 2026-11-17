import type { AssistantMessage, ChatEvent, ChatStep, ChatThread } from "./types";

/**
 * Upserts a progress step by id. Version 1 events never regress: an older attempt,
 * a stale sequence, or a restart of a settled step without a new attempt is ignored.
 * Returns the same array when nothing changed.
 */
export function mergeStep(steps: ChatStep[], step: ChatStep): ChatStep[] {
  const previous = steps.find((item) => item.id === step.id);
  if (previous?.progressVersion === 1) {
    if (step.progressVersion !== 1) return steps;
    const before = previous.attempt ?? 0, after = step.attempt ?? 0;
    if (after < before || (after === before && ((step.sequence ?? 0) <= (previous.sequence ?? 0)
      || previous.status !== "active" && step.status === "active"))) return steps;
  }
  return previous
    ? steps.map((item) => (item.id === step.id ? step : item))
    : [...steps, step];
}

/** Applies one event to the thread's trailing assistant message. */
export function applyChatEvent(
  thread: ChatThread,
  messageId: string,
  event: ChatEvent,
): ChatThread {
  if (event.type === "session")
    return { ...thread, serverThreadId: event.serverThreadId };
  if (event.type === "title") {
    return { ...thread, title: event.title };
  }
  if (event.type === "todos") {
    return { ...thread, todos: event.todos };
  }
  return updateAssistantMessage(thread, messageId, (message) => {
    switch (event.type) {
      case "sources":
        return {
          ...message,
          citations: event.citations,
          warnings: event.warnings,
        };
      case "reasoning":
        return { ...message, reasoning: message.reasoning + event.delta };
      case "text-replace":
        return { ...message, text: event.text };
      case "text":
        return { ...message, text: message.text + event.delta };
      case "step": {
        const steps = mergeStep(message.steps, event.step);
        if (steps === message.steps) return message;
        return {
          ...message,
          webRequested: message.webRequested || (event.step.id === "web" || event.step.parent === "web"),
          steps,
        };
      }
    }
  });
}

export function updateAssistantMessage(
  thread: ChatThread,
  messageId: string,
  update: (message: AssistantMessage) => AssistantMessage,
): ChatThread {
  return {
    ...thread,
    messages: thread.messages.map((message) =>
      message.id === messageId && message.role === "assistant"
        ? update(message)
        : message,
    ),
  };
}

/** Ends a turn, settling anything a stopped stream left marked as running. */
export function finishAssistantMessage(
  message: AssistantMessage,
  status: AssistantMessage["status"],
  durationSeconds: number,
): AssistantMessage {
  return {
    ...message,
    status,
    durationSeconds,
    steps: message.steps.map((step) =>
      step.status === "active"
        ? { ...step, status: status === "error" ? "failed" : status === "stopped" ? "stopped" : "stopped" }
        : step,
    ),
  };
}
