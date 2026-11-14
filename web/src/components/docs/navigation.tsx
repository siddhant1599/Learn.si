"use client";

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useTheme } from 'next-themes';
import { docs, docHref, searchDocs } from '@/content/docs';
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogTrigger } from '@/components/ui/dialog';

export function DocsNavigation() {
 const pathname = usePathname();
 const disclosure = useRef<HTMLDetailsElement>(null);
 useEffect(() => { if (disclosure.current) disclosure.current.open = false; }, [pathname]);
 const links = <nav aria-label="Documentation pages" className="space-y-6">
  {[...new Set(docs.map(d => d.group))].map(group => <div key={group}>
   <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">{group}</p>
   <ul className="space-y-1">{docs.filter(d => d.group === group).map(d => <li key={d.slug}>
    <Link href={docHref(d.slug)} onClick={() => { if (disclosure.current) disclosure.current.open = false; }} aria-current={pathname === docHref(d.slug) ? 'page' : undefined}
     className="block rounded-md px-3 py-2 text-sm hover:bg-accent aria-[current=page]:bg-accent aria-[current=page]:font-semibold">{d.slug ? d.title : 'Overview'}</Link>
   </li>)}</ul>
  </div>)}
 </nav>;
 return <aside className="min-w-0 lg:sticky lg:top-24 lg:self-start">
  <div className="hidden lg:block">{links}</div>
  <details ref={disclosure} className="rounded-lg border p-3 lg:hidden"><summary className="cursor-pointer font-medium">Browse documentation</summary><div className="pt-5">{links}</div></details>
 </aside>;
}

export function DocsSearch() {
 const [open, setOpen] = useState(false);
 const [query, setQuery] = useState('');
 const results = searchDocs(query);
 useEffect(() => {
  const shortcut = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setOpen(value => !value); } };
  window.addEventListener('keydown', shortcut);
  return () => window.removeEventListener('keydown', shortcut);
 }, []);
 return <Dialog open={open} onOpenChange={setOpen}>
  <DialogTrigger className="rounded-md border px-3 py-2 text-sm hover:bg-accent">Search docs</DialogTrigger>
  <DialogContent>
   <DialogTitle>Search documentation</DialogTitle>
   <DialogDescription>Search these guides. Uploaded documents and chats are not indexed.</DialogDescription>
   <label htmlFor="docs-search" className="sr-only">Search documentation</label>
   <input id="docs-search" type="search" autoComplete="off" value={query} onChange={e => setQuery(e.target.value)}
    onKeyDown={e => { if(e.key === 'ArrowDown') {e.preventDefault(); document.querySelector<HTMLAnchorElement>('[data-doc-result]')?.focus();} }}
    className="w-full rounded-md border bg-background p-3" placeholder="Try citations or Pinecone" />
   <p role="status" className="text-sm text-muted-foreground">{query.trim() ? `${results.length} results${results.length ? '' : ' — try another topic'}` : 'Enter a topic to search.'}</p>
   <ul className="max-h-[50vh] overflow-y-auto">{results.map((result,index) => <li key={result.href}>
    <Link data-doc-result href={result.href} onClick={() => setOpen(false)}
     onKeyDown={e => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
       e.preventDefault(); const nodes = document.querySelectorAll<HTMLAnchorElement>('[data-doc-result]');
       nodes[(index + (e.key === 'ArrowDown' ? 1 : -1) + nodes.length) % nodes.length]?.focus();
      }
     }} className="block rounded-md p-3 hover:bg-accent focus:bg-accent">
     <span className="block font-medium">{result.heading}</span><span className="text-sm text-muted-foreground">{result.title}</span>
    </Link>
   </li>)}</ul>
  </DialogContent>
 </Dialog>;
}

export function DocsTheme() {
 const {resolvedTheme,setTheme} = useTheme();
 return <button className="rounded-md border px-3 py-2 text-sm hover:bg-accent" onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}>Toggle theme</button>;
}
