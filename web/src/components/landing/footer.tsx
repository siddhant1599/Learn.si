import { site } from "@/config/site";
import { cn } from "@/lib/utils";

export function Footer({ className }: { className?: string }) {
  return (
    <footer className={cn("mx-auto w-full max-w-6xl border-t border-white/15 px-4 py-10", className)}>
      <p className="text-center font-serif text-lg text-white/65">&quot;{site.footer.quote}&quot;</p>
      <p className="mt-4 text-center text-xs text-white/45">&copy; {new Date().getFullYear()} {site.name}</p>
    </footer>
  );
}
