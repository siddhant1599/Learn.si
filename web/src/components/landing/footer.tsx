import Link from "next/link";

import { site } from "@/config/site";
import { cn } from "@/lib/utils";

export function Footer({ className }: { className?: string }) {
  return (
    <footer className={cn("mx-auto w-full max-w-6xl border-t border-white/15 px-4 py-10", className)}>
      <div className="flex flex-col justify-between gap-6 sm:flex-row">
        <div>
          <p className="font-serif text-xl">{site.name}</p>
          <p className="mt-2 max-w-md text-sm leading-6 text-white/60">{site.description}</p>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap items-start gap-x-6 gap-y-3 text-sm text-white/75">
          <Link href="/workspace" className="hover:text-white">Workspace</Link>
          <Link href="/docs" className="hover:text-white">Docs</Link>
          <a href={site.repositoryUrl} className="hover:text-white">Repository</a>
          <a href={`${site.repositoryUrl}/blob/main/web/LICENSE`} className="hover:text-white">Frontend MIT license</a>
        </nav>
      </div>
      <p className="mt-10 text-center font-serif text-lg text-white/65">&quot;{site.footer.quote}&quot;</p>
      <p className="mt-4 text-center text-xs text-white/45">&copy; {new Date().getFullYear()} {site.name}</p>
    </footer>
  );
}
