import type { Metadata } from "next";
import { HowItWorks, TrustSection, ClosingCta } from "@/components/landing/product-sections";

import { ConstellationSection } from "@/components/landing/constellation-section";
import { Footer } from "@/components/landing/footer";
import { Header } from "@/components/landing/header";
import { Hero } from "@/components/landing/hero";
import { RagExamples } from "@/components/landing/rag-examples";
import { WhatsNewSection } from "@/components/landing/sections/whats-new-section";

export const metadata: Metadata = { alternates: { canonical: "/" } };

export default function LandingPage() {
  return (
    // The landing is always dark; scope the theme tokens so light-mode visitors get dark values too.
    <div className="dark min-h-screen w-full overflow-x-clip bg-[#0a0a0a] text-white">
      <Header />
      <main className="flex w-full flex-col">
        <Hero />
        <RagExamples />
        <ConstellationSection />
        <WhatsNewSection />
        <HowItWorks />
        <TrustSection />
        <ClosingCta />
      </main>
      <Footer />
    </div>
  );
}
