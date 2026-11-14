import { cn } from "@/lib/utils";

export function Section({
  className,
  id,
  title,
  subtitle,
  children,
}: {
  className?: string;
  id?: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      className={cn("mx-auto flex w-full min-w-0 flex-col py-16", className)}
    >
      <header className="flex flex-col items-center justify-between px-4">
        {/* Real headings: the page outline is one h1 (hero) and an h2 per section. */}
        <h2 className="mb-4 max-w-full bg-linear-to-r from-white via-gray-200 to-gray-400 bg-clip-text text-center text-3xl font-bold break-words text-transparent sm:text-4xl md:text-5xl">
          {title}
        </h2>
        {subtitle && (
          <p className="text-muted-foreground max-w-full text-center text-base break-words sm:text-lg md:text-xl">
            {subtitle}
          </p>
        )}
      </header>
      <div className="mt-4 w-full min-w-0 px-4">{children}</div>
    </section>
  );
}
