import Link from 'next/link';
export default function DocsNotFound() { return <main id="docs-content"><h1 className="text-3xl font-semibold">Documentation not found</h1><p className="my-4">That page is not published. Browse the guides or search for your topic.</p><Link className="underline" href="/docs">Return to Docs</Link></main>; }
