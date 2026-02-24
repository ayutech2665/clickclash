// PageShell — wraps every page content area.
// Sets the paper-texture background, max-width container, and consistent padding.
// All pages import this instead of repeating layout classes.

import React from "react";

interface PageShellProps {
  children: React.ReactNode;
  /** Extra Tailwind classes on the inner content wrapper */
  className?: string;
}

export default function PageShell({ children, className = "" }: PageShellProps) {
  return (
    <div className="min-h-screen w-full" style={{ background: "var(--color-cream)" }}>
      {/* Inner content: centred, max-width capped, responsive padding */}
      <div
        className={`mx-auto w-full max-w-2xl px-4 pb-12 pt-4 sm:px-6 ${className}`}
      >
        {children}
      </div>
    </div>
  );
}
