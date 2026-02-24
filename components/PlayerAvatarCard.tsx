// PlayerAvatarCard — displays a single player slot.
// Works for both Phase 1 (mock) and Phase 2 (real) data via the shared Player type.
// Phase 3: isSpeaking will be driven by WebRTC audio level detection.

import React from "react";
import type { Player } from "@/lib/types";

interface PlayerAvatarCardProps {
  player: Player;
  slotNumber: number;
  /** Highlight this card as "you" */
  isYou?: boolean;
  /** Show score badge (used on the play screen) */
  showScore?: boolean;
}

function HumanIcon({ connected }: { connected: boolean }) {
  const color = connected ? "var(--color-ink)" : "var(--color-muted)";
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <circle cx="20" cy="11" r="7" fill={color} opacity={connected ? 1 : 0.35} />
      <path
        d="M8 34c0-6.627 5.373-12 12-12s12 5.373 12 12"
        stroke={color}
        strokeWidth="3"
        strokeLinecap="round"
        opacity={connected ? 1 : 0.35}
      />
    </svg>
  );
}

export default function PlayerAvatarCard({
  player,
  slotNumber,
  isYou = false,
  showScore = false,
}: PlayerAvatarCardProps) {
  const isConnected = player.isConnected;
  const isSpeaking  = player.isSpeaking ?? false;

  return (
    <div
      className={[
        "flex flex-col items-center gap-2 rounded-crayon border-[2.5px] p-3 text-center transition-all duration-200",
        isConnected
          ? "bg-[var(--color-paper)] border-[var(--color-border)] shadow-crayon-sm"
          : "bg-[#f0ead6] border-dashed border-[var(--color-muted)]",
        // "You" indicator: subtle highlight ring
        isYou && isConnected ? "ring-2 ring-offset-1 ring-[var(--color-pink)]" : "",
      ].join(" ")}
      aria-label={
        isConnected
          ? `Player ${slotNumber}: ${player.username}${player.isHost ? " (host)" : ""}${isYou ? " — you" : ""}`
          : `Player slot ${slotNumber}: waiting`
      }
    >
      {/* Avatar ring — glows teal when speaking (Phase 3) */}
      <div
        className={[
          "relative flex h-14 w-14 items-center justify-center rounded-full border-[3px]",
          isSpeaking
            ? "border-[var(--color-teal)] shadow-[0_0_0_4px_var(--color-teal)]"
            : isConnected
            ? "border-[var(--color-border)]"
            : "border-dashed border-[var(--color-muted)]",
          !isConnected ? "animate-soft-pulse" : "",
        ].join(" ")}
        style={{ background: isConnected ? "var(--color-yellow)" : "#e8e0cc" }}
      >
        <HumanIcon connected={isConnected} />

        {/* Host crown */}
        {player.isHost && isConnected && (
          <span className="absolute -top-2 -right-2 text-base leading-none" title="Host" aria-label="Host">
            👑
          </span>
        )}

        {/* "You" badge */}
        {isYou && isConnected && (
          <span
            className="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded-full px-1.5 text-[9px] font-bold leading-none py-0.5"
            style={{ background: "var(--color-pink)", color: "#fff" }}
          >
            YOU
          </span>
        )}
      </div>

      {/* Username */}
      <span
        className={[
          "text-sm font-bold leading-tight",
          isConnected ? "text-[var(--color-ink)]" : "text-[var(--color-muted)] animate-soft-pulse",
        ].join(" ")}
      >
        {player.username}
      </span>

      {/* Score badge (play screen) */}
      {showScore && isConnected && (
        <span
          className="rounded-full px-2 py-0.5 text-xs font-bold"
          style={{ background: "var(--color-yellow)", color: "var(--color-ink)" }}
        >
          {player.score ?? 0} pts
        </span>
      )}

      {/* Speaking indicator placeholder (Phase 3: WebRTC will drive isSpeaking) */}
      {isConnected && !showScore && (
        <span className="text-xs" style={{ color: "var(--color-muted)" }} aria-hidden="true">
          {isSpeaking ? "🎙 Speaking" : "🔇"}
        </span>
      )}
    </div>
  );
}
