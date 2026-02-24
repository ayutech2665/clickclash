// useVoiceChat — React hook wrapping VoiceClient for use in VoicePanel.
//
// Manages VoiceClient lifecycle via a ref. Callbacks from VoiceClient
// update React state. The client is destroyed on hook unmount.
//
// Usage:
//   const { state, enableVoice, mute, unmute } = useVoiceChat(roomCode, mySocketId, username);

"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { getSocket } from "@/lib/socket";
import { VoiceClient } from "./voiceClient";
import type { VoiceState } from "./types";

const INITIAL_STATE: VoiceState = {
  status: "idle",
  permission: "unknown",
  isMuted: false,
  errorMessage: null,
  speakingIds: new Set(),
  voiceParticipantIds: new Set(),
  peerHealthMap: new Map(),
  callStartedAt: null,
};

export function useVoiceChat(roomCode: string, mySocketId: string, username: string) {
  const clientRef = useRef<VoiceClient | null>(null);
  const [state, setState] = useState<VoiceState>(INITIAL_STATE);

  // Destroy client on unmount (this is the key cleanup path — VoicePanel
  // is only rendered when playState === "answered", so unmounting it cleans up voice).
  useEffect(() => {
    return () => {
      clientRef.current?.destroy();
      clientRef.current = null;
    };
  }, []);

  /** Called by user gesture (Enable Voice button click). */
  const enableVoice = useCallback(async () => {
    if (clientRef.current) return; // already active

    const socket = getSocket();
    const client = new VoiceClient(socket, roomCode, mySocketId, username);
    clientRef.current = client;

    // Wire callbacks to React setState
    client.onStatusChange = (status) => {
      setState((prev) => ({ ...prev, status }));
    };

    client.onPermissionChange = (permission) => {
      setState((prev) => ({ ...prev, permission }));
    };

    client.onSpeakingChange = (socketId, speaking) => {
      setState((prev) => {
        const next = new Set(prev.speakingIds);
        if (speaking) next.add(socketId);
        else next.delete(socketId);
        return { ...prev, speakingIds: next };
      });
    };

    client.onVoiceParticipantsChange = (ids) => {
      setState((prev) => ({ ...prev, voiceParticipantIds: new Set(ids) }));
    };

    try {
      await client.init();
    } catch (err) {
      setState((prev) => ({
        ...prev,
        status: "error",
        errorMessage: (err as Error).message,
      }));
      // Leave the client ref so destroy() still runs on unmount,
      // but mark it so re-enable creates a fresh one.
      clientRef.current = null;
    }
  }, [roomCode, mySocketId, username]);

  const mute = useCallback(() => {
    clientRef.current?.mute();
    setState((prev) => ({ ...prev, isMuted: true }));
  }, []);

  const unmute = useCallback(() => {
    clientRef.current?.unmute();
    setState((prev) => ({ ...prev, isMuted: false }));
  }, []);

  const leaveVoice = useCallback(() => {
    clientRef.current?.destroy();
    clientRef.current = null;
    setState(INITIAL_STATE);
  }, []);

  return { state, enableVoice, mute, unmute, leaveVoice };
}
