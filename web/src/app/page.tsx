import type { Metadata } from "next";

import { ConstellationSection } from "@/components/landing/constellation-section";
import { Footer } from "@/components/landing/footer";
import { Header } from "@/components/landing/header";
import { Hero } from "@/components/landing/hero";
import { RagExamples } from "@/components/landing/rag-examples";
import { WhatsNewSection } from "@/components/landing/sections/whats-new-section";

export const metadata: Metadata = { alternates: { canonical: "/" } };

export default function LandingPage() {
  return (
    <div className="min-h-screen w-full overflow-x-clip bg-[#0a0a0a]">
      <Header />
      <main className="flex w-full flex-col">
        <Hero />
        <RagExamples />
        <ConstellationSection />
        <WhatsNewSection />
      </main>
      <Footer />
    </div>
  );
}
