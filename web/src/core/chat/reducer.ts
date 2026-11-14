import type { AssistantMessage, ChatEvent, ChatThread } from "./types";

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
      case "persistence":
        return { ...message, webRequested: true, persistedAnswer: event.text, persistedCitations: event.citations };
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
        const previous = message.steps.find(step => step.id === event.step.id);
        if (previous?.progressVersion === 1) {
          if (event.step.progressVersion !== 1) return message;
          const before = previous.attempt ?? 0, after = event.step.attempt ?? 0;
          if (after < before || (after === before && ((event.step.sequence ?? 0) <= (previous.sequence ?? 0)
            || previous.status !== "active" && event.step.status === "active"))) return message;
        }
        const exists = !!previous;
        return {
          ...message,
          webRequested: message.webRequested || (event.step.id === "web" || event.step.parent === "web"),
          steps: exists
            ? message.steps.map((step) =>
                step.id === event.step.id ? event.step : step,
              )
            : [...message.steps, event.step],
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
