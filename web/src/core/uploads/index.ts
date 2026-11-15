import type { FileUIPart } from "ai";

export type PromptInputFilePart = FileUIPart & {
  // Transient submit-time handle to the original browser File; not serializable.
  file?: File;
};

const MACOS_APP_BUNDLE_CONTENT_TYPES = new Set([
  "",
  "application/octet-stream",
]);

export const MACOS_APP_BUNDLE_UPLOAD_MESSAGE =
  "macOS .app bundles can't be uploaded directly from the browser. Compress the app as a .zip or upload the .dmg instead.";

export function isLikelyMacOSAppBundle(file: Pick<File, "name" | "type">) {
  return (
    file.name.toLowerCase().endsWith(".app") &&
    MACOS_APP_BUNDLE_CONTENT_TYPES.has(file.type)
  );
}

export function splitUnsupportedUploadFiles(fileList: File[] | FileList) {
  const incoming = Array.from(fileList);
  const accepted: File[] = [];
  const rejected: File[] = [];

  for (const file of incoming) {
    if (isLikelyMacOSAppBundle(file)) {
      rejected.push(file);
      continue;
    }
    accepted.push(file);
  }

  return {
    accepted,
    rejected,
    message: rejected.length > 0 ? MACOS_APP_BUNDLE_UPLOAD_MESSAGE : undefined,
  };
}

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const UPLOAD_SIZE_MESSAGE = "Choose a nonempty file no larger than 10 MB.";
export const UPLOAD_ACCEPT = ".pdf,.txt,.md";
export const UPLOAD_LIMITS =
  "PDF, TXT, Markdown. 10 MB, 100 pages, 1 million characters, 600 chunks. Scanned PDFs need OCR. Indexing can take up to 30 minutes.";

export type UploadedDocument = { id: string; title: string; edition: string; chunks: number };

/** Raw-bytes upload shared by Ask and Master; surfaces the backend's own message. */
export async function uploadDocument(file: File, signal?: AbortSignal): Promise<UploadedDocument> {
  if (file.size > MAX_UPLOAD_BYTES || !file.size) throw new Error(UPLOAD_SIZE_MESSAGE);
  const response = await fetch(
    "/api/rag/documents/upload?filename=" + encodeURIComponent(file.name),
    {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: file,
      signal: signal ?? AbortSignal.timeout(1830000),
    },
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(typeof data.detail === "string" ? data.detail : "Upload failed.");
  return data as UploadedDocument;
}
