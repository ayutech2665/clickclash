// VoicePanel — expanded voice UI with player speaking cards.
//
// Shown on the play screen after reveal so players can see who's speaking.
// Phase 6: each player card shows a signal quality indicator (connecting /
// connected / degraded / failed) with colour coding and optional RTT label.
// Reads all state from VoiceContext — no local state or lifecycle management.

"use client";

import { useVoiceControls, useVoiceActivity } from "@/lib/voice/VoiceContext";
import CrayonCard from "./CrayonCard";
import PlayerAvatarCard from "./PlayerAvatarCard";
import type { Player } from "@/lib/types";
import type { PeerQuality } from "@/lib/voice/types";

function MicOnIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <rect x="7" y="1" width="6" height="11" rx="3" />
      <path d="M4 10a6 6 0 0 0 12 0" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
      <line x1="10" y1="16" x2="10" y2="19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <line x1="7" y1="19" x2="13" y2="19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function MicOffIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <rect x="7" y="1" width="6" height="11" rx="3" opacity="0.3" />
      <path d="M4 10a6 6 0 0 0 12 0" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" opacity="0.3" />
      <line x1="10" y1="16" x2="10" y2="19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <line x1="7" y1="19" x2="13" y2="19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <line x1="3" y1="3" x2="17" y2="17" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

// ---- Signal quality indicator ----

const QUALITY_COLOR: Record<PeerQuality, string> = {
  connecting: "var(--color-muted)",
  connected:  "var(--color-teal)",
  degraded:   "var(--color-yellow)",
  failed:     "var(--color-red)",
};

const QUALITY_LABEL: Record<PeerQuality, string> = {
  connecting: "connecting…",
  connected:  "good",
  degraded:   "weak signal",
  failed:     "disconnected",
};

interface SignalBadgeProps {
  quality: PeerQuality;
  roundTripMs: number | null;
  isYou: boolean;
}

function SignalBadge({ quality, roundTripMs, isYou }: SignalBadgeProps) {
  const color = QUALITY_COLOR[quality];
  const label = isYou ? "you" : QUALITY_LABEL[quality];
  const rttLabel = !isYou && roundTripMs !== null ? ` · ${roundTripMs} ms` : "";

  return (
    <div className="mt-1 flex items-center justify-center gap-1">
      <span
        className="h-1.5 w-1.5 rounded-full flex-shrink-0"
        style={{ background: color }}
        aria-hidden="true"
      />
      <span
        className="text-[10px] font-bold leading-none"
        style={{ color }}
      >
        {label}{rttLabel}
      </span>
    </div>
  );
}

interface VoicePanelProps {
  mySocketId: string;
  /** Full room player list — enriched with live speaking state. */
  roomPlayers: Player[];
}

export default function VoicePanel({ mySocketId, roomPlayers }: VoicePanelProps) {
  const { status, isMuted, voiceParticipantIds, mute, unmute } = useVoiceControls();
  const { speakingIds, peerHealthMap } = useVoiceActivity();

  if (status !== "connected" && status !== "reconnecting") return null;

  const enrichedPlayers: Player[] = roomPlayers.map((p) => ({
    ...p,
    isSpeaking: speakingIds.has(p.id),
  }));

  const voicePlayers = enrichedPlayers.filter(
    (p) => p.isConnected && voiceParticipantIds.has(p.id)
  );

  return (
    <CrayonCard className="mb-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="font-bold" style={{ color: "var(--color-ink)" }}>
          🎙 Voice Chat
          {voicePlayers.length > 0 && (
            <span className="ml-1.5 text-sm font-normal" style={{ color: "var(--color-muted)" }}>
              ({voicePlayers.length} in call)
            </span>
          )}
          {status === "reconnecting" && (
            <span className="ml-2 text-xs font-normal animate-soft-pulse" style={{ color: "var(--color-yellow)" }}>
              reconnecting…
            </span>
          )}
        </p>

        {/* Mute / unmute */}
        <button
          onClick={isMuted ? unmute : mute}
          className="flex min-h-[44px] items-center gap-1.5 rounded-crayon border-[2px] px-3 py-1.5 text-sm font-bold transition-all"
          style={{
            background: isMuted ? "var(--color-red)" : "var(--color-teal)",
            borderColor: isMuted ? "#c04040" : "#2a8a84",
            color: "#fff",
            boxShadow: isMuted ? "2px 2px 0 #c04040" : "2px 2px 0 #2a8a84",
          }}
          aria-pressed={isMuted}
          aria-label={isMuted ? "Unmute microphone" : "Mute microphone"}
        >
          {isMuted ? <MicOffIcon /> : <MicOnIcon />}
          <span>{isMuted ? "Unmute" : "Mute"}</span>
        </button>
      </div>

      {voicePlayers.length > 0 ? (
        <div className="flex flex-wrap justify-center gap-3">
          {voicePlayers.map((p, i) => {
            const isYou = p.id === mySocketId;
            const health = isYou ? null : peerHealthMap.get(p.id);
            const quality: PeerQuality = health?.quality ?? "connecting";

            return (
              <div key={p.id} className="flex flex-col items-center">
                <PlayerAvatarCard
                  player={p}
                  slotNumber={i + 1}
                  isYou={isYou}
                />
                <SignalBadge
                  quality={isYou ? "connected" : quality}
                  roundTripMs={health?.roundTripMs ?? null}
                  isYou={isYou}
                />
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-center text-sm animate-soft-pulse" style={{ color: "var(--color-muted)" }}>
          Waiting for others to join voice…
        </p>
      )}

      <p className="mt-3 text-center text-xs" style={{ color: "var(--color-muted)" }}>
        🔒 Peer-to-peer. Not recorded.
      </p>
    </CrayonCard>
  );
}
