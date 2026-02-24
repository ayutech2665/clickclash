// HeaderBar — top navigation bar present on every page.
// Shows the app name on the left and optional action slot on the right.
// Kept intentionally simple for Phase 1; Phase 3 will add player avatar/status.

"use client";

import Link from "next/link";
import React from "react";

interface HeaderBarProps {
  /** Optional content rendered on the right side of the header */
  rightSlot?: React.ReactNode;
}

export default function HeaderBar({ rightSlot }: HeaderBarProps) {
  return (
    <header
      className="sticky top-0 z-50 w-full"
      style={{
        background: "var(--color-yellow)",
        borderBottom: "2.5px solid var(--color-border)",
        boxShadow: "0 3px 0 var(--color-border)",
      }}
    >
      <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3 sm:px-6">
        {/* Brand / home link */}
        <Link
          href="/"
          className="flex items-center gap-2 text-2xl font-bold leading-none tracking-tight"
          style={{ color: "var(--color-ink)", textDecoration: "none" }}
          aria-label="ClickClash home"
        >
          {/* Simple crayon-pencil emoji as lightweight logo */}
          <span aria-hidden="true">✏️</span>
          <span>ClickClash</span>
        </Link>

        {/* Optional right-side slot (e.g., room code badge) */}
        {rightSlot && (
          <div className="flex items-center gap-2">{rightSlot}</div>
        )}
      </div>
    </header>
  );
}
