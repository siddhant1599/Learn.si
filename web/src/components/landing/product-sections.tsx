import Image from "next/image";
import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { privacySummary } from "@/content/privacy";
import { Section } from "./section";

const workflows = [
  { name: "Ask", title: "A question. An answer. Its source.", image: "ask", alt: "Ask workspace showing an Archive Handbook answer with a document citation", steps: [
    { title: "Upload", text: "Add a PDF, TXT or Markdown file, then select your sources." },
    { title: "Ask", text: "Ask a focused question. Follow the activity as your answer is prepared." },
    { title: "Follow the citation", text: "Inspect the source details. Any web findings are labeled separately." },
  ] },
  { name: "Master", title: "A document. A lesson. A little progress.", image: "master", alt: "Master workspace showing an Archive labels lesson, source citations and its tutor panel", steps: [
    { title: "Add a document", text: "Choose a source and let Study Buddy organize a lesson plan." },
    { title: "Learn lesson by lesson", text: "Read, try an exercise and ask the tutor for guidance. Go at your own pace." },
    { title: "Pass quizzes to unlock", text: "Answer two of three correctly to unlock the next lesson and track your progress." },
  ] },
];

export function HowItWorks() {
  return (
    <Section id="how-it-works" title="Make your documents part of your day" subtitle="Choose your mode in the workspace. Start with what you want to understand.">
      <div className="mx-auto mt-10 max-w-6xl space-y-16">
        {workflows.map((flow) => (
          <article key={flow.name} className="grid gap-8 lg:grid-cols-[0.8fr_1.2fr] lg:items-center">
            <div>
              <p className="text-xs font-semibold tracking-widest text-[#e9c665] uppercase">{flow.name}</p>
              <h3 className="mt-3 font-serif text-3xl leading-tight">{flow.title}</h3>
              <ol className="mt-6 space-y-5" aria-label={`${flow.name} steps`}>
                {flow.steps.map((step, index) => (
                  <li key={step.title} className="flex gap-4">
                    <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-full border border-[#e9c665]/30 text-xs text-[#e9c665]">{index + 1}</span>
                    <div><h4 className="text-sm font-semibold">{step.title}</h4><p className="mt-1 text-sm leading-6 text-white/65">{step.text}</p></div>
                  </li>
                ))}
              </ol>
            </div>
            <figure className="min-w-0">
              <a href={`/images/product-${flow.image}.png`} aria-label={`View full-size ${flow.name} screenshot`} className="block overflow-hidden rounded-xl border border-white/15 shadow-2xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#e9c665]">
                <Image src={`/images/product-${flow.image}.png`} alt={flow.alt} width={1440} height={1000} sizes="(min-width: 1024px) 640px, 100vw" className="h-auto w-full" />
              </a>
              <figcaption className="mt-3 text-xs leading-5 text-white/50">Actual workspace · fictional Archive Handbook · recorded example responses. Open image to inspect.</figcaption>
            </figure>
          </article>
        ))}
      </div>
    </Section>
  );
}

export function TrustSection() {
  return (
    <Section id="privacy" title="Know where your information goes" subtitle="A local workspace, with clear boundaries around storage and external services.">
      <div className="mx-auto mt-10 grid max-w-6xl gap-6 sm:grid-cols-2">
        {privacySummary.map((item) => (
          <article key={item.title} className="rounded-xl border border-white/10 bg-white/[0.025] p-6">
            <h3 className="font-serif text-xl text-[#e9c665]">{item.title}</h3>
            <p className="mt-3 text-sm leading-7 text-white/70">{item.text}</p>
          </article>
        ))}
      </div>
      <p className="mt-6 text-center text-sm"><Link href="/docs/evidence" className="text-white/75 underline underline-offset-4 hover:text-white">Read the evidence and privacy guide</Link></p>
    </Section>
  );
}

export function ClosingCta() {
  return (
    <section aria-labelledby="closing-title" className="mx-auto my-16 w-full max-w-6xl px-4">
      <div className="rounded-2xl border border-[#e9c665]/20 bg-gradient-to-br from-[#e9c665]/10 to-transparent px-6 py-14 text-center sm:px-12">
        <h2 id="closing-title" className="font-serif text-3xl sm:text-4xl">Your next insight is already in your documents.</h2>
        <p className="mx-auto mt-4 max-w-xl text-sm leading-7 text-white/65">Bring a question or spend some time learning. Your workspace has room for both.</p>
        <Button asChild size="lg" className="mt-7"><Link href="/workspace">Open your workspace <ArrowRightIcon aria-hidden="true" className="size-4" /></Link></Button>
      </div>
    </section>
  );
}
