"use client";

import { FileText, Globe } from "lucide-react";

import { safeWebUrl } from "@/core/chat/privacy";
import { useChatStore } from "@/core/chat/store";
import type { Citation } from "@/core/chat/types";

/** The element id of citation `n` under message `messageId`, for links from the source tree. */
export const citationAnchor = (messageId: string, n: number) => `citation-${messageId}-${n}`;

/** Sources as the landing demo shows them: one line per citation, number in blue. Shared by Ask and Master. */
export function CitationList({ citations, anchor }: { citations: Citation[]; anchor?: string }) {
  const { deletions } = useChatStore();
  return (
    <div className="mt-4 space-y-2" aria-label="Sources">
      {citations.map((c, index) => (
        <div
          key={c.citation}
          id={anchor ? citationAnchor(anchor, c.citation) : undefined}
          style={{ animationDelay: `${index * 50}ms` }}
          className="flex min-w-0 scroll-mt-24 items-start gap-2 rounded-md text-xs text-zinc-700 dark:text-muted-foreground transition-[background-color,box-shadow] duration-500 animate-in fade-in slide-in-from-left-2 motion-reduce:animate-none fill-mode-both data-[flash]:bg-blue-500/15 data-[flash]:ring-2 data-[flash]:ring-blue-500/50"
        >
          {c.source_type === "web" ? (
            <>
              <Globe aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-green-600 dark:text-green-400" />
              <div className="min-w-0">
                <span>
                  Web · <span className="text-blue-700 dark:text-blue-300">[{c.citation}]</span>{" "}
                </span>
                {safeWebUrl(c.url) ? (
                  <a href={c.url} target="_blank" rel="noopener noreferrer" className="break-all underline underline-offset-2 hover:text-foreground">
                    {c.title} · {new URL(c.url).hostname}
                  </a>
                ) : (
                  <span>Unavailable web link</span>
                )}
                {c.published_date && <p>Published: {c.published_date}</p>}
              </div>
            </>
          ) : (
            <>
              <FileText aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
              <details className="min-w-0">
                <summary className="cursor-pointer break-words hover:text-foreground">
                  <span className="text-blue-700 dark:text-blue-300">[{c.citation}]</span> {c.document_title}
                  {c.page ? ` · Page ${c.page}` : ""}
                  {deletions.some((d) => d.kind === "document" && d.id === c.document_id) && " · Source unavailable (deleted)"}
                </summary>
                <p className="mt-1">
                  {c.edition} · {c.kind} {c.number}
                </p>
              </details>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
