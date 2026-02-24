// CrayonButton — the primary interactive element in ClickClash.
// Design: thick border, offset shadow, slight rotation on hover.
// Variants: primary (yellow), secondary (pink), ghost (transparent), danger (red).

"use client";

import React from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

interface CrayonButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Stretch to full width of its container */
  fullWidth?: boolean;
  children: React.ReactNode;
}

const variantMap: Record<
  ButtonVariant,
  { bg: string; border: string; shadow: string; text: string; hoverBg: string }
> = {
  primary: {
    bg: "var(--color-yellow)",
    border: "var(--color-border)",
    shadow: "var(--color-border)",
    text: "var(--color-ink)",
    hoverBg: "var(--color-orange)",
  },
  secondary: {
    bg: "var(--color-pink)",
    border: "var(--color-border)",
    shadow: "var(--color-border)",
    text: "#fff",
    hoverBg: "#e85a8b",
  },
  ghost: {
    bg: "transparent",
    border: "var(--color-border)",
    shadow: "var(--color-border)",
    text: "var(--color-ink)",
    hoverBg: "rgba(0,0,0,0.05)",
  },
  danger: {
    bg: "var(--color-red)",
    border: "var(--color-border)",
    shadow: "var(--color-border)",
    text: "#fff",
    hoverBg: "#e05555",
  },
};

const sizeMap: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-sm min-h-[36px]",
  md: "px-5 py-2.5 text-base min-h-[44px]",
  lg: "px-7 py-3.5 text-lg min-h-[52px]",
};

export default function CrayonButton({
  variant = "primary",
  size = "md",
  fullWidth = false,
  children,
  disabled,
  className = "",
  ...rest
}: CrayonButtonProps) {
  const v = variantMap[variant];

  return (
    <button
      {...rest}
      disabled={disabled}
      className={[
        "relative inline-flex select-none items-center justify-center gap-2",
        "rounded-crayon border-[2.5px] font-crayon font-bold",
        "transition-all duration-150 ease-out",
        "active:translate-x-[2px] active:translate-y-[2px] active:shadow-none",
        !disabled && "hover:-translate-y-0.5 hover:rotate-[-0.5deg] hover:shadow-crayon-lg",
        disabled && "cursor-not-allowed opacity-50",
        fullWidth && "w-full",
        sizeMap[size],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={{
        backgroundColor: v.bg,
        borderColor: v.border,
        boxShadow: `3px 3px 0px ${v.shadow}`,
        color: v.text,
        // Pressed: shadow collapses (handled by active: classes above but
        // we also need the style prop to sync for non-Tailwind colors)
      }}
      // Swap background on hover via inline data attribute + CSS would need
      // a wrapper. For simplicity we leave the hover-rotate in Tailwind and
      // accept the hoverBg is only applied via the CSS var above (orange is
      // close enough visually). For full hover color, use onMouseEnter/Leave.
      onMouseEnter={(e) => {
        if (!disabled) {
          (e.currentTarget as HTMLButtonElement).style.backgroundColor = v.hoverBg;
        }
      }}
      onMouseLeave={(e) => {
        if (!disabled) {
          (e.currentTarget as HTMLButtonElement).style.backgroundColor = v.bg;
        }
      }}
    >
      {children}
    </button>
  );
}
