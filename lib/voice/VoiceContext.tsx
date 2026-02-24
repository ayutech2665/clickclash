// VoiceContext — room-scoped voice state, split into two independent contexts to
// prevent high-frequency audio updates from re-rendering the mute button / header.
//
// WHY TWO CONTEXTS
//   Speaking detection fires every 100 ms. If all consumers share one context,
//   every speaking pulse causes the entire tree — including the sticky ScoreBar
//   and the Mute button — to re-render. Splitting into:
//
//   VoiceControlsContext  — changes rarely: status, isMuted, participant count,
//                           callStartedAt, initVoice, mute, unmute, leaveVoice
//
//   VoiceActivityContext  — changes frequently: speakingIds (100 ms),
//                           peerHealthMap (2 s via getStats)
//
// CONSUMER GUIDE
//   useVoiceControls() → VoiceBar, any header/button component
//   useVoiceActivity() → ScoreBar speaking dots, VoicePanel, lobby avatar glow
//   useVoice()         → convenience alias returning both (for callers that need all state)

"use client";

import {
  createContext,
  useContext,
  useRef,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import { getSocket } from "@/lib/socket";
import { VoiceClient } from "./voiceClient";
import type { VoiceStatus, VoicePermission, PeerHealth } from "./types";

// ============================================================
// Context value types
// ============================================================

export interface VoiceControlsValue {
  status: VoiceStatus;
  permission: VoicePermission;
  isMuted: boolean;
  voiceParticipantIds: Set<string>;
  callStartedAt: number | null;
  errorMessage: string | null;
  initVoice: (socketId: string, username: string) => void;
  mute: () => void;
  unmute: () => void;
  leaveVoice: () => void;
}

export interface VoiceActivityValue {
  /** Speakers detected via AnalyserNode RMS — updates up to 10×/s. */
  speakingIds: Set<string>;
  /** Per-peer ICE health — updates every 2 s. */
  peerHealthMap: Map<string, PeerHealth>;
}

/** Legacy combined type — prefer the split hooks for hot-path components. */
export type VoiceContextValue = VoiceControlsValue & VoiceActivityValue;

// ============================================================
// Contexts
// ============================================================

const VoiceControlsCtx = createContext<VoiceControlsValue | null>(null);
const VoiceActivityCtx = createContext<VoiceActivityValue | null>(null);

// ============================================================
// Provider
// ============================================================

interface VoiceProviderProps {
  roomCode: string;
  children: ReactNode;
}

const INITIAL_CONTROLS: Omit<VoiceControlsValue, "initVoice" | "mute" | "unmute" | "leaveVoice"> = {
  status: "idle",
  permission: "unknown",
  isMuted: false,
  voiceParticipantIds: new Set(),
  callStartedAt: null,
  errorMessage: null,
};

const INITIAL_ACTIVITY: VoiceActivityValue = {
  speakingIds: new Set(),
  peerHealthMap: new Map(),
};

export function VoiceProvider({ roomCode, children }: VoiceProviderProps) {
  const clientRef = useRef<VoiceClient | null>(null);

  // Two independent state slices — speaking/health changes only update activity,
  // never the controls slice, so the header does not re-render.
  const [controls, setControls] = useState(INITIAL_CONTROLS);
  const [activity, setActivity] = useState<VoiceActivityValue>(INITIAL_ACTIVITY);

  // Destroy client when user leaves /room entirely (layout unmount)
  useEffect(() => {
    return () => {
      clientRef.current?.destroy();
      clientRef.current = null;
    };
  }, []); // empty deps — fires only on layout unmount

  const initVoice = useCallback(
    (socketId: string, username: string) => {
      if (clientRef.current) return; // idempotent

      const socket = getSocket();
      const client = new VoiceClient(socket, roomCode, socketId, username);
      clientRef.current = client;

      // ---- Callbacks that only touch controls state ----

      client.onStatusChange = (status) =>
        setControls((prev) => ({
          ...prev,
          status,
          callStartedAt:
            status === "connected" && prev.callStartedAt === null
              ? Date.now()
              : prev.callStartedAt,
        }));

      client.onPermissionChange = (permission) =>
        setControls((prev) => ({ ...prev, permission }));

      client.onVoiceParticipantsChange = (ids) =>
        setControls((prev) => ({ ...prev, voiceParticipantIds: new Set(ids) }));

      // ---- Callbacks that only touch activity state ----
      // These can fire up to 10×/s — they must never touch `setControls`.

      client.onSpeakingChange = (id, speaking) =>
        setActivity((prev) => {
          const next = new Set(prev.speakingIds);
          if (speaking) next.add(id);
          else next.delete(id);
          return { ...prev, speakingIds: next };
        });

      client.onPeerHealthChange = (peerId, health) =>
        setActivity((prev) => {
          const next = new Map(prev.peerHealthMap);
          next.set(peerId, health);
          return { ...prev, peerHealthMap: next };
        });

      client.init().catch((err: Error) => {
        setControls((prev) => ({
          ...prev,
          status: "error",
          errorMessage: err.message,
        }));
        clientRef.current = null;
      });
    },
    [roomCode]
  );

  const mute = useCallback(() => {
    clientRef.current?.mute();
    setControls((prev) => ({ ...prev, isMuted: true }));
  }, []);

  const unmute = useCallback(() => {
    clientRef.current?.unmute();
    setControls((prev) => ({ ...prev, isMuted: false }));
  }, []);

  const leaveVoice = useCallback(() => {
    clientRef.current?.destroy();
    clientRef.current = null;
    setControls(INITIAL_CONTROLS);
    setActivity(INITIAL_ACTIVITY);
  }, []);

  const controlsValue: VoiceControlsValue = {
    ...controls,
    initVoice,
    mute,
    unmute,
    leaveVoice,
  };

  return (
    <VoiceControlsCtx.Provider value={controlsValue}>
      <VoiceActivityCtx.Provider value={activity}>
        {children}
      </VoiceActivityCtx.Provider>
    </VoiceControlsCtx.Provider>
  );
}

// ============================================================
// Hooks
// ============================================================

/** Controls context — rare updates. Use in header / mute button. */
export function useVoiceControls(): VoiceControlsValue {
  const ctx = useContext(VoiceControlsCtx);
  if (!ctx) throw new Error("useVoiceControls must be used inside <VoiceProvider>");
  return ctx;
}

/** Activity context — frequent updates (speaking, health). Use in score bars / panels. */
export function useVoiceActivity(): VoiceActivityValue {
  const ctx = useContext(VoiceActivityCtx);
  if (!ctx) throw new Error("useVoiceActivity must be used inside <VoiceProvider>");
  return ctx;
}

/**
 * Combined hook — returns both controls and activity.
 * Convenience for components that need everything.
 * NOTE: subscribes to BOTH contexts, so re-renders on speaking changes.
 * Prefer useVoiceControls() + useVoiceActivity() in hot-path components.
 */
export function useVoice(): VoiceContextValue {
  const controls = useVoiceControls();
  const act = useVoiceActivity();
  return { ...controls, ...act };
}
