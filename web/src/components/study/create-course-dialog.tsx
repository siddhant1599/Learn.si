"use client";

import { FileTextIcon, Loader2, UploadIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useChatStore } from "@/core/chat/store";
import { courseHref } from "@/core/study/format";
import { useStudyStore } from "@/core/study/store";
import { UPLOAD_ACCEPT, UPLOAD_LIMITS, uploadDocument } from "@/core/uploads";

/**
 * Create a course from a new upload or an existing source. Uploading here never
 * selects the document for Ask or starts a chat.
 */
export function CreateCourseDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const { documents, refreshDocuments } = useChatStore();
  const { courses, create } = useStudyStore();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [selected, setSelected] = useState("");
  const withCourse = new Set(courses.map((c) => c.document_id));
  const available = documents.filter((d) => !withCourse.has(d.id));

  async function start(documentId: string) {
    const course = await create(documentId);
    onOpenChange(false);
    router.push(courseHref(course.id));
    toast.success("Course created. Preparing the lesson plan.");
  }

  async function run(task: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await task();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Course creation failed. Please retry.");
      setStatus("");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  function upload(file: File) {
    void run(async () => {
      setStatus(`Indexing ${file.name}… Keep this page open.`);
      const document = await uploadDocument(file);
      setStatus(`Indexed ${document.title}. Creating the course…`);
      await refreshDocuments();
      await start(document.id);
    });
  }

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!busy) { onOpenChange(value); setError(""); setStatus(""); } }}>
      <DialogContent className="sm:max-w-lg">
        <DialogTitle>New course</DialogTitle>
        <DialogDescription>
          Master mode turns one document into modules of short lessons with quizzes. Planning runs in the background.
        </DialogDescription>
        <Tabs defaultValue="upload" className="min-w-0">
          <TabsList className="w-full">
            <TabsTrigger value="upload" disabled={busy}>Upload a document</TabsTrigger>
            <TabsTrigger value="sources" disabled={busy}>From your sources</TabsTrigger>
          </TabsList>
          <TabsContent value="upload" className="space-y-3 pt-2">
            <Button className="w-full gap-2" variant="outline" disabled={busy} onClick={() => input.current?.click()}>
              {busy ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : <UploadIcon aria-hidden="true" className="size-4" />}
              {busy ? "Working…" : "Choose a file"}
            </Button>
            <input
              ref={input}
              type="file"
              accept={UPLOAD_ACCEPT}
              className="hidden"
              aria-label="Upload a document for a new course"
              onChange={(e) => { const file = e.target.files?.[0]; if (file) upload(file); }}
            />
            <p className="text-xs leading-5 text-muted-foreground">{UPLOAD_LIMITS}</p>
          </TabsContent>
          <TabsContent value="sources" className="space-y-3 pt-2">
            {available.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {documents.length ? "Every source already has a course." : "No sources yet. Upload a document instead."}
              </p>
            ) : (
              <fieldset className="max-h-60 space-y-1 overflow-y-auto" disabled={busy}>
                <legend className="sr-only">Choose a source</legend>
                {available.map((d) => (
                  <label key={d.id} className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2 text-sm ${selected === d.id ? "border-border bg-accent" : "border-transparent hover:bg-accent/50"}`}>
                    <input type="radio" name="course-source" className="mt-1" checked={selected === d.id} onChange={() => setSelected(d.id)} />
                    <FileTextIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 [overflow-wrap:anywhere]">
                      {d.title}
                      {d.edition && <small className="block text-xs text-muted-foreground">{d.edition}</small>}
                    </span>
                  </label>
                ))}
              </fieldset>
            )}
            <Button className="w-full" disabled={busy || !available.some((d) => d.id === selected)} onClick={() => void run(() => start(selected))}>
              {busy && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
              Create course
            </Button>
          </TabsContent>
        </Tabs>
        {status && <p role="status" className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{status}</p>}
        {error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}
