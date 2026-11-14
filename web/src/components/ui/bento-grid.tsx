import type { CSSProperties, ReactNode, RefObject } from "react";

import "./magic-bento.css";

/** Server-renderable bento markup. MagicBento layers gsap effects over this same DOM. */
export type BentoCardData = {
  color?: string;
  title?: ReactNode;
  description?: ReactNode;
  label?: ReactNode;
};

export function bentoCardClassName({
  textAutoHide = false,
  borderGlow = true,
}: {
  textAutoHide?: boolean;
  borderGlow?: boolean;
} = {}) {
  return [
    "magic-bento-card",
    textAutoHide && "magic-bento-card--text-autohide",
    borderGlow && "magic-bento-card--border-glow",
  ]
    .filter(Boolean)
    .join(" ");
}

export function BentoGrid({
  children,
  gridRef,
  className = "",
}: {
  children: ReactNode;
  gridRef?: RefObject<HTMLDivElement | null>;
  className?: string;
}) {
  return (
    <div className={`card-grid bento-section ${className}`.trim()} ref={gridRef}>
      {children}
    </div>
  );
}

/** Card inner content. Titles are h3: the section heading above them is the h2. */
export function BentoCardBody({ card }: { card: BentoCardData }) {
  return (
    <>
      <div className="magic-bento-card__header">
        <div className="magic-bento-card__label">{card.label}</div>
      </div>
      <div className="magic-bento-card__content">
        <h3 className="magic-bento-card__title">{card.title}</h3>
        <p className="magic-bento-card__description">{card.description}</p>
      </div>
    </>
  );
}

/** Plain cards with no JavaScript behavior: the SSR fallback and the mobile rendering. */
export function StaticBentoGrid({
  data,
  glowColor = "132, 0, 255",
  className,
}: {
  data: BentoCardData[];
  glowColor?: string;
  className?: string;
}) {
  return (
    <BentoGrid className={className}>
      {data.map((card, index) => (
        <div
          key={index}
          className={bentoCardClassName()}
          style={
            {
              backgroundColor: card.color,
              "--glow-color": glowColor,
              position: "relative",
              overflow: "hidden",
            } as CSSProperties
          }
        >
          <BentoCardBody card={card} />
        </div>
      ))}
    </BentoGrid>
  );
}
