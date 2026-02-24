import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ClickClash — Multiplayer Trivia",
  description:
    "Race your friends to answer trivia questions, discuss answers via voice, and crown the fastest brain!",
  // Viewport meta is set automatically by Next.js 14 App Router
};

/**
 * Root layout — wraps every page.
 *
 * Design decision: Patrick Hand is loaded here via a <link> tag so it is
 * available globally without a separate npm package. We preconnect to Google
 * Fonts to avoid an extra DNS lookup round-trip.
 */
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        {/* Google Fonts — Patrick Hand: a natural, hand-written feel */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Patrick+Hand&display=swap"
          rel="stylesheet"
        />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body className="font-crayon">{children}</body>
    </html>
  );
}
