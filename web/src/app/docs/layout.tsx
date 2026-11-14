import Link from 'next/link';
import { DocsNavigation, DocsSearch, DocsTheme } from '@/components/docs/navigation';

export default function DocsLayout({children}: {children: React.ReactNode}) {
 return <div className="min-h-screen bg-background text-foreground">
  <a href="#docs-content" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:bg-background focus:p-3">Skip to documentation</a>
  <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur">
   <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-4 sm:px-6">
    <Link href="/" className="mr-auto font-serif text-xl">Document Lab</Link>
    <Link href="/workspace" className="text-sm underline underline-offset-4">Workspace</Link>
    <DocsSearch/><DocsTheme/>
   </div>
  </header>
  <div className="mx-auto grid max-w-7xl gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[220px_minmax(0,1fr)]">
   <DocsNavigation/>{children}
  </div>
 </div>;
}
