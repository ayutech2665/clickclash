// VoiceBar — compact, stable voice control strip for the sticky score bar.
//
// Flicker fixes (Phase 6 post-fix):
//   1. Uses useVoiceControls() — not the full context — so speaking detection
//      (100 ms) and health updates (2 s) never cause this component to re-render.
//   2. MuteButton is React.memo'd with a stable min-width, so layout never shifts
//      and the button is never remounted on mute/unmute transitions.
//   3. CallTimer is React.memo'd with its own internal interval — it ticks every
//      second in isolation without re-rendering VoiceBar.
//   4. A single stable JSX tree for all states — no conditional top-level returns
//      that would swap the DOM tree and remount children.
//   5. No "status" words (connecting/reconnecting/degraded) — only a colour dot.

"use client";

import React, { memo, useCallback, useEffect, useState } from "react";
import { useVoiceControls } from "@/lib/voice/VoiceContext";

// ---- Icons (pure SVG, no state) ----

function MicOnIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <rect x="7" y="1" width="6" height="11" rx="3" />
      <path d="M4 10a6 6 0 0 0 12 0" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
      <line x1="10" y1="16" x2="10" y2="19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <line x1="7" y1="19" x2="13" y2="19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function MicOffIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <rect x="7" y="1" width="6" height="11" rx="3" opacity="0.3" />
      <path d="M4 10a6 6 0 0 0 12 0" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" opacity="0.3" />
      <line x1="10" y1="16" x2="10" y2="19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <line x1="7" y1="19" x2="13" y2="19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <line x1="3" y1="3" x2="17" y2="17" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

// ============================================================
// MuteButton — memo'd so it only re-renders when isMuted changes.
// Fixed min-width prevents layout shift between "Mute"/"Unmute".
// ============================================================

interface MuteButtonProps {
  isMuted: boolean;
  disabled: boolean;
  onToggle: () => void;
}

const MuteButton = memo(function MuteButton({ isMuted, disabled, onToggle }: MuteButtonProps) {
  return (
    <button
      onClick={onToggle}
      disabled={disabled}
      // min-w keeps "Mute" and "Unmute" the same width — no layout shift
      className="flex min-h-[44px] min-w-[96px] items-center justify-center gap-1.5 rounded-crayon border-[2px] px-3 py-2 text-sm font-bold transition-colors active:translate-x-[1px] active:translate-y-[1px]"
      style={{
        background:   disabled ? "#b0a898"              : isMuted ? "var(--color-red)"  : "var(--color-teal)",
        borderColor:  disabled ? "#8a8078"              : isMuted ? "#c04040"           : "#2a8a84",
        color:        "#fff",
        boxShadow:    disabled ? "2px 2px 0 #8a8078"   : isMuted ? "2px 2px 0 #c04040" : "2px 2px 0 #2a8a84",
        cursor:       disabled ? "default" : "pointer",
      }}
      aria-pressed={isMuted}
      aria-label={isMuted ? "Unmute microphone" : "Mute microphone"}
    >
      {isMuted ? <MicOffIcon /> : <MicOnIcon />}
      {/* Always render the same <span> node — only its text changes */}
      <span className="hidden sm:inline">{isMuted ? "Unmute" : "Mute"}</span>
    </button>
  );
});

// ============================================================
// CallTimer — memo'd, manages its own 1-second interval.
// Never causes VoiceBar to re-render.
// ============================================================

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, "0");
  const s = (seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

interface CallTimerProps {
  startedAt: number | null;
}

const CallTimer = memo(function CallTimer({ startedAt }: CallTimerProps) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!startedAt) {
      setElapsed(0);
      return;
    }
    setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    const t = setInterval(
      () => setElapsed(Math.floor((Date.now() - startedAt) / 1000)),
      1000
    );
    return () => clearInterval(t);
  }, [startedAt]);

  if (elapsed === 0) return null;
  return (
    <span
      className="text-xs font-bold tabular-nums"
      style={{ color: "var(--color-muted)" }}
      title="Call duration"
    >
      {formatDuration(elapsed)}
    </span>
  );
});

// ============================================================
// VoiceBar — reads controls context only (no speakingIds / peerHealthMap).
// Renders a stable DOM tree at all times to prevent layout shifts.
// ============================================================

export default function VoiceBar() {
  const {
    status,
    isMuted,
    voiceParticipantIds,
    callStartedAt,
    mute,
    unmute,
  } = useVoiceControls();

  // Stable toggle callback — only recreated when isMuted/mute/unmute change
  const handleToggle = useCallback(() => {
    if (isMuted) unmute();
    else mute();
  }, [isMuted, mute, unmute]);

  const isConnected = status === "connected" || status === "reconnecting";
  const inCall      = voiceParticipantIds.size;

  // Dot colour: teal=connected, yellow=reconnecting, red=error, transparent=pending
  const dotColor =
    status === "connected"    ? "var(--color-teal)"  :
    status === "reconnecting" ? "var(--color-yellow)" :
    status === "error"        ? "var(--color-red)"    :
    "transparent";

  return (
    <div className="flex items-center gap-2 flex-shrink-0">
      {/* Status dot — colour only, no words */}
      <span
        className="h-2 w-2 rounded-full flex-shrink-0 transition-colors duration-500"
        style={{ background: dotColor }}
        aria-hidden="true"
      />

      {/* Mute button — always present, disabled until connected */}
      <MuteButton
        isMuted={isMuted}
        disabled={!isConnected}
        onToggle={handleToggle}
      />

      {/* "N in call" + timer — visible once we have participants */}
      {isConnected && inCall > 0 && (
        <span className="text-xs font-bold whitespace-nowrap" style={{ color: "var(--color-muted)" }}>
          {inCall} in call
        </span>
      )}

      {isConnected && <CallTimer startedAt={callStartedAt} />}
    </div>
  );
}
