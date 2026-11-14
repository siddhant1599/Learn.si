import Link from 'next/link';
import { notFound } from 'next/navigation';
import { site } from '@/config/site';
import { docs, docHref, findDoc } from '@/content/docs';

type Props = {params: Promise<{slug?: string[]}>};
export function generateStaticParams() { return docs.map(page => ({slug: page.slug ? [page.slug] : []})); }
export async function generateMetadata({params}: Props) {
 const page = findDoc(((await params).slug ?? []).join('/'));
 return {title: page ? `${page.title} | ${site.name}` : 'Documentation not found', description:page?.summary};
}
export default async function DocsPage({params}: Props) {
 const page = findDoc(((await params).slug ?? []).join('/'));
 if (!page) notFound();
 const index = docs.indexOf(page);
 return <div className="grid min-w-0 gap-8 xl:grid-cols-[minmax(0,1fr)_180px]">
  <main id="docs-content" tabIndex={-1} className="min-w-0 max-w-3xl scroll-mt-28 outline-none">
   <p className="mb-3 text-sm text-muted-foreground">Docs / {page.group}</p>
   <h1 className="font-serif text-4xl leading-tight">{page.title}</h1>
   <p className="mt-4 text-lg text-muted-foreground">{page.summary}</p>
   <nav aria-label="On this page" className="my-6 rounded-lg border p-4 xl:hidden"><p className="mb-2 font-medium">On this page</p><ul className="space-y-2">{page.sections.map(s => <li key={s.id}><a className="text-sm underline underline-offset-4" href={`#${s.id}`}>{s.title}</a></li>)}</ul></nav>
   {page.sections.map(section => <section key={section.id} aria-labelledby={section.id} className="mt-10">
    <h2 id={section.id} className="mb-4 scroll-mt-36 text-2xl font-semibold"><a href={`#${section.id}`} className="hover:underline">{section.title}<span className="sr-only"> — section link</span></a></h2>
    {section.paragraphs.map(p => <p key={p} className="mb-4 leading-7 [overflow-wrap:anywhere]">{p}</p>)}
    {section.code && <pre tabIndex={0} aria-label={`${section.title} code example`} className="my-5 max-w-full overflow-x-auto rounded-lg border bg-muted p-4 text-sm leading-6"><code>{section.code}</code></pre>}
    {section.links && <ul className="my-4 space-y-2">{section.links.map(link => <li key={link.href}><Link className="underline underline-offset-4" href={link.href}>{link.label} →</Link></li>)}</ul>}
   </section>)}
   <nav aria-label="Adjacent documentation pages" className="mt-12 flex flex-wrap justify-between gap-4 border-t pt-6 text-sm">
    {index > 0 && <Link href={docHref(docs[index-1]!.slug)}>← {docs[index-1]!.title}</Link>}
    {index < docs.length-1 && <Link href={docHref(docs[index+1]!.slug)}>{docs[index+1]!.title} →</Link>}
   </nav>
  </main>
  <nav aria-label="On this page" className="sticky top-28 hidden self-start text-sm xl:block"><p className="mb-4 font-medium">On this page</p><ul className="space-y-3">{page.sections.map(s => <li key={s.id}><a className="text-muted-foreground hover:text-foreground hover:underline" href={`#${s.id}`}>{s.title}</a></li>)}</ul></nav>
 </div>;
}
