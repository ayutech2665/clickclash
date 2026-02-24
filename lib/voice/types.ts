// Types shared between VoiceClient and VoiceContext / VoicePanel.

export type VoicePermission = "unknown" | "granted" | "denied";

/** idle → connecting → connected.  connected → reconnecting on ICE failure. */
export type VoiceStatus = "idle" | "connecting" | "connected" | "reconnecting" | "error";

/** Signal quality state for an individual peer connection. */
export type PeerQuality = "connecting" | "connected" | "degraded" | "failed";

export interface PeerHealth {
  quality: PeerQuality;
  /** Current round-trip time in milliseconds, or null if not yet measured. */
  roundTripMs: number | null;
}

export interface VoiceState {
  status: VoiceStatus;
  permission: VoicePermission;
  isMuted: boolean;
  errorMessage: string | null;
  /** Set of socketIds currently detected as speaking (local + remote). */
  speakingIds: Set<string>;
  /** Set of socketIds currently in the voice room (including self). */
  voiceParticipantIds: Set<string>;
  /** Per-peer connection health; keyed by remote socketId. */
  peerHealthMap: Map<string, PeerHealth>;
  /** Timestamp (Date.now()) when voice reached "connected" status. */
  callStartedAt: number | null;
}
