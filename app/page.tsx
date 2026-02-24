// "/" — Landing / Game Details page
// First thing a new visitor sees. Explains the game, shows two CTAs.
// Client component for hover effects; no data fetching needed.

"use client";

import Link from "next/link";
import PageShell from "@/components/PageShell";
import HeaderBar from "@/components/HeaderBar";
import CrayonCard from "@/components/CrayonCard";
import CrayonButton from "@/components/CrayonButton";

const rules = [
  { emoji: "👥", text: "Up to 4 players in one room" },
  { emoji: "❓", text: "10 trivia questions per round" },
  { emoji: "⚡", text: "First to click the correct answer scores more points" },
  {
    emoji: "🎙",
    text: (
      <>
        Discuss answers via live voice chat{" "}
        <span
          className="ml-1 rounded-full px-2 py-0.5 text-xs font-bold"
          style={{
            background: "var(--color-purple)",
            color: "var(--color-ink)",
          }}
        >
          Phase 3
        </span>
      </>
    ),
  },
];

export default function LandingPage() {
  return (
    <>
      <HeaderBar />
      <PageShell>
        {/* Hero section */}
        <section className="mt-8 flex flex-col items-center text-center">
          {/* Logo mark */}
          <div
            className="mb-4 flex h-24 w-24 items-center justify-center rounded-full border-[3px] text-5xl shadow-crayon"
            style={{
              background: "var(--color-yellow)",
              borderColor: "var(--color-border)",
            }}
            aria-hidden="true"
          >
            ✏️
          </div>

          <h1
            className="mb-3 leading-tight"
            style={{ color: "var(--color-ink)" }}
          >
            Click<span style={{ color: "var(--color-pink)" }}>Clash</span>
          </h1>

          <p
            className="mb-2 max-w-md text-lg"
            style={{ color: "var(--color-ink)" }}
          >
            The fast-paced multiplayer trivia game where speed{" "}
            <em>and</em> knowledge win.
          </p>
          <p
            className="mb-8 max-w-sm text-base"
            style={{ color: "var(--color-muted)" }}
          >
            Gather your crew, pick a category, and race to click the right
            answer before everyone else does!
          </p>

          {/* CTA buttons */}
          <div className="flex w-full max-w-sm flex-col gap-3 sm:flex-row sm:justify-center">
            <Link href="/create" className="flex-1">
              <CrayonButton variant="primary" size="lg" fullWidth>
                🚀 Create Room
              </CrayonButton>
            </Link>
            <Link href="/join" className="flex-1">
              <CrayonButton variant="secondary" size="lg" fullWidth>
                🔑 Enter Room
              </CrayonButton>
            </Link>
          </div>
        </section>

        {/* How to play */}
        <section className="mt-10" aria-labelledby="how-to-play-heading">
          <h2
            id="how-to-play-heading"
            className="mb-4 text-center"
            style={{ color: "var(--color-ink)" }}
          >
            How to Play
          </h2>

          <CrayonCard className="flex flex-col gap-3">
            {rules.map((rule, i) => (
              <div key={i} className="flex items-start gap-3">
                {/* Number badge */}
                <span
                  className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-sm font-bold"
                  style={{
                    background: "var(--color-yellow)",
                    borderColor: "var(--color-border)",
                  }}
                  aria-hidden="true"
                >
                  {i + 1}
                </span>
                <span className="flex items-center gap-1 text-base leading-snug">
                  <span aria-hidden="true" className="text-xl">
                    {rule.emoji}
                  </span>
                  <span style={{ color: "var(--color-ink)" }}>{rule.text}</span>
                </span>
              </div>
            ))}
          </CrayonCard>
        </section>

        {/* Tagline footer nudge */}
        <p
          className="mt-8 text-center text-sm"
          style={{ color: "var(--color-muted)" }}
        >
          No sign-up required — just pick a name and play!
        </p>
      </PageShell>
    </>
  );
}
