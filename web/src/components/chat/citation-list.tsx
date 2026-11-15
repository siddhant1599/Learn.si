"use client";

import { safeWebUrl } from "@/core/chat/privacy";
import { useChatStore } from "@/core/chat/store";
import type { Citation } from "@/core/chat/types";

/** Source chips shared by Ask answers and Master lessons. */
export function CitationList({ citations }: { citations: Citation[] }) {
  const { deletions } = useChatStore();
  return (
    <div className="mt-5 flex flex-wrap gap-2" aria-label="Sources">
      {citations.map((c) => c.source_type === "web" ? (
        <div key={c.citation} className="bg-secondary/50 max-w-full rounded-lg border px-3 py-2 text-xs">
          <span>Web · [{c.citation}] </span>
          {safeWebUrl(c.url) ? <a href={c.url} target="_blank" rel="noopener noreferrer"
            className="underline break-all">{c.title} · {new URL(c.url).hostname}</a> : <span>Unavailable web link</span>}
          {c.published_date && <p>Published: {c.published_date}</p>}
          <p>Web links are not retained after reload.</p>
        </div>
      ) : (
        <details
          key={c.citation}
          className="bg-secondary/50 max-w-full rounded-lg border px-3 py-2 text-xs"
        >
          <summary className="cursor-pointer break-words">
            [{c.citation}] {c.document_title}
            {c.page ? ` · Page ${c.page}` : ""}
            {deletions.some(d => d.kind === "document" && d.id === c.document_id) && " · Source unavailable (deleted)"}
          </summary>
          <p className="mt-2">
            {c.edition} · {c.kind} {c.number}
          </p>
        </details>
      ))}
    </div>
  );
}
