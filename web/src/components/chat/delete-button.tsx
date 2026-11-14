"use client";
import { useRef, useState } from "react";
import { Trash2 } from "lucide-react";
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
      <DialogTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={`Delete ${title}`} onClick={() => setError("")}><Trash2 className="size-3" /></Button></DialogTrigger>
      <DialogContent>
        <DialogTitle>Delete {title}?</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
        {error && <p role="alert">{error}</p>}
        <DialogFooter>
          <Button autoFocus variant="outline" disabled={pending} onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="destructive" disabled={pending} onClick={() => void confirm()}>{pending ? "Deleting…" : error ? "Retry deletion" : "Delete"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
