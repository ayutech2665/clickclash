// CrayonCard — hand-drawn style card container.
// Thick border + offset shadow = hand-drawn feel without external SVG filters.
// Pass `variant` to switch surface color.

import React from "react";

type CardVariant = "default" | "highlight" | "muted" | "error";

interface CrayonCardProps {
  children: React.ReactNode;
  variant?: CardVariant;
  className?: string;
  /** Renders as a <section> with a given label for accessibility */
  "aria-label"?: string;
}

const variantStyles: Record<CardVariant, React.CSSProperties> = {
  default: {
    background: "var(--color-paper)",
    borderColor: "var(--color-border)",
    boxShadow: "4px 4px 0px var(--color-border)",
  },
  highlight: {
    background: "var(--color-yellow)",
    borderColor: "var(--color-border)",
    boxShadow: "4px 4px 0px var(--color-border)",
  },
  muted: {
    background: "#F5EED8",
    borderColor: "#B0A898",
    boxShadow: "4px 4px 0px #B0A898",
  },
  error: {
    background: "#FFE5E5",
    borderColor: "var(--color-red)",
    boxShadow: "4px 4px 0px var(--color-red)",
  },
};

export default function CrayonCard({
  children,
  variant = "default",
  className = "",
  "aria-label": ariaLabel,
}: CrayonCardProps) {
  return (
    <div
      role={ariaLabel ? "region" : undefined}
      aria-label={ariaLabel}
      className={`rounded-crayon border-[2.5px] p-4 sm:p-5 ${className}`}
      style={variantStyles[variant]}
    >
      {children}
    </div>
  );
}
