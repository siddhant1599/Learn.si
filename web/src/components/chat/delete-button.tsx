"use client";
import { useRef, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogTrigger, DialogContent, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

export function DeleteButton({ title, description, onDelete }: { title: string; description: string; onDelete: () => Promise<void> }) {
  const [open, setOpen] = useState(false), [pending, setPending] = useState(false), [error, setError] = useState("");
  const running = useRef(false);
  async function confirm() {
    if (running.current) return;
    running.current = true; setPending(true); setError("");
    try { await onDelete(); setOpen(false); }
    catch (e) { setError(e instanceof Error ? e.message : "Deletion failed. Please retry."); }
    finally { running.current = false; setPending(false); }
  }
  return <>
    <Dialog open={open} onOpenChange={value => { if (!pending) setOpen(value); }}>
      <DialogTrigger asChild><Button variant="ghost" size="icon-sm" className="delete-action" title={`Delete ${title}`} aria-label={`Delete ${title}`} onClick={() => setError("")}><Trash2 className="size-4" strokeWidth={1.75} /></Button></DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <div aria-hidden="true" className="flex size-11 items-center justify-center rounded-xl bg-destructive/10 text-destructive"><Trash2 className="size-5" strokeWidth={1.75} /></div>
        <DialogTitle className="break-words pr-6">Delete {title}?</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
        {error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button autoFocus variant="outline" disabled={pending} onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="destructive" disabled={pending} onClick={() => void confirm()}>{pending && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}{pending ? "Deleting…" : error ? "Retry deletion" : "Delete"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
