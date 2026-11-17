import { expect, it } from "vitest";
import { persistedThread, safeWebUrl } from "@/core/chat/privacy";
import type { ChatThread } from "@/core/chat/types";

const url = "https://example.org/public-source";
const answer = "## From your documents\n\nLabels are blue [1].\n\n## From the web\n\nThe standard agrees [2]. " + url;
function thread(): ChatThread {
  return { id: "t", title: "Question " + url, documentIds: ["d"], todos: [], updatedAt: 1, messages: [
    { id: "u", role: "user", text: "Question " + url, files: [] },
    { id: "a", role: "assistant", status: "complete", text: answer, reasoning: "", steps: [], webRequested: true,
      citations: [
        { citation: 1, document_id: "d", document_title: "Manual", edition: "v1", number: "1", kind: "section", text: "raw chunk" } as never,
        { source_type: "web", citation: 2, title: "Source", url, retrieved_at: "today", published_date: "2026-01-01", excerpt: "raw page" } as never,
      ],
      // Stripped copy from an older build: ignored and dropped.
      persistedAnswer: "Document answer only", persistedCitations: [],
    }] };
}
it("keeps the web answer, its From the web section and source links in browser storage", () => {
  const t = thread(), snapshot = structuredClone(t), stored = persistedThread(t);
  const a = stored.messages[1]!;
  expect(a.text).toBe(answer);
  expect(stored.title).toBe("Question " + url);
  expect(stored.messages[0]!.text).toBe("Question " + url);
  if (a.role !== "assistant") throw new Error("assistant expected");
  expect(a.citations).toEqual([
    { citation: 1, document_id: "d", document_title: "Manual", edition: "v1", number: "1", kind: "section" },
    { source_type: "web", citation: 2, title: "Source", url, retrieved_at: "today", published_date: "2026-01-01" },
  ]);
  expect(a).not.toHaveProperty("persistedAnswer");
  expect(JSON.stringify(stored)).not.toContain("raw page");
  expect(JSON.stringify(stored)).not.toContain("raw chunk");
  expect(t).toEqual(snapshot);
});
it.each(["streaming", "error", "stopped"] as const)("keeps %s web drafts as shown", status => {
  const t = thread(), m = t.messages[1]!;
  if (m.role === "assistant") m.status = status;
  expect(persistedThread(t).messages[1]!.text).toBe(answer);
});
it.each(["javascript:alert(1)", "file:///etc/passwd", "https://u:p@example.org", "not a URL"])("rejects unsafe link %s", url => {
  expect(safeWebUrl(url)).toBe(false);
});
it("permits public HTTPS links", () => expect(safeWebUrl(url)).toBe(true));
