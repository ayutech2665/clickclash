// VoiceClient — manages WebRTC mesh voice chat for one room session.
//
// Phase 6 upgrades vs Phase 5:
//   A) TURN support: fetches ICE server list from server via voice:ice-config:get
//      instead of hardcoding STUN-only. TURN credentials never appear in client JS.
//   B) Health monitoring: polls getStats() every 2 s per peer; surfaces
//      round-trip time and ICE connection state via onPeerHealthChange.
//   C) Auto-reconnect: ICE restart on "failed" state. The "polite" peer
//      (lower socket ID) initiates an ICE-restart offer after a 3 s delay.
//   D) Audio quality: getUserMedia with echo cancellation, noise suppression,
//      auto gain control, mono 48 kHz audio. Speaking detection never touches
//      track.enabled — it reads AnalyserNode RMS instead.
//
// Mesh topology: each joining client sends offers to all existing peers.
// When a new peer joins later they send US an offer and we answer.
//
// Lifecycle:
//   new VoiceClient(socket, roomCode, mySocketId, username)
//   client.onStatusChange = ...    // set callbacks before calling init
//   await client.init()            // request mic, fetch ICE config, join room
//   client.mute() / client.unmute()
//   client.destroy()               // stop mic, close PCs, emit voice:leave

import { type Socket } from "socket.io-client";
import type { ServerToClientEvents, ClientToServerEvents } from "../socket";
import { createAnalyser, isSpeakingNow } from "./audioLevel";
import type { VoicePermission, VoiceStatus, PeerHealth, PeerQuality } from "./types";

const SPEAKING_POLL_MS = 100;
const HEALTH_POLL_MS   = 2000;
/** After ICE "failed", how long before the polite peer attempts a restart. */
const ICE_RESTART_DELAY_MS = 3000;

/** High-quality mono audio constraints for voice chat. */
const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  channelCount: 1,
  // Prefer 48 kHz — Opus codec picks this up automatically in most browsers.
  sampleRate: 48000,
};

interface PeerState {
  pc: RTCPeerConnection;
  audioEl: HTMLAudioElement;
  analyser: AnalyserNode | null;
  audioCtx: AudioContext | null;
  iceRestartTimer: ReturnType<typeof setTimeout> | null;
}

export class VoiceClient {
  private readonly socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  private readonly roomCode: string;
  private readonly mySocketId: string;
  private readonly username: string;

  private iceServers: RTCIceServer[] = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ];

  private localStream: MediaStream | null = null;
  private localAudioCtx: AudioContext | null = null;
  private localAnalyser: AnalyserNode | null = null;
  private localSpeaking = false;

  /** socketId → peer connection state */
  private peers = new Map<string, PeerState>();
  /** All socketIds in voice (including self), maintained for UI updates */
  private voiceParticipantIds = new Set<string>();

  private speakingTimer: ReturnType<typeof setInterval> | null = null;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private destroyed = false;

  // ---- Callbacks (set by VoiceContext before calling init) ----
  onStatusChange?: (status: VoiceStatus) => void;
  onPermissionChange?: (perm: VoicePermission) => void;
  onSpeakingChange?: (socketId: string, speaking: boolean) => void;
  onVoiceParticipantsChange?: (ids: Set<string>) => void;
  onPeerHealthChange?: (socketId: string, health: PeerHealth) => void;

  // ---- Bound signal handlers ----
  private readonly _onPeerJoined: (data: { socketId: string; username: string }) => void;
  private readonly _onPeerLeft: (data: { socketId: string }) => void;
  private readonly _onOffer: (data: { fromSocketId: string; offer: RTCSessionDescriptionInit }) => void;
  private readonly _onAnswer: (data: { fromSocketId: string; answer: RTCSessionDescriptionInit }) => void;
  private readonly _onIce: (data: { fromSocketId: string; candidate: RTCIceCandidateInit }) => void;

  constructor(
    socket: Socket<ServerToClientEvents, ClientToServerEvents>,
    roomCode: string,
    mySocketId: string,
    username: string
  ) {
    this.socket = socket;
    this.roomCode = roomCode;
    this.mySocketId = mySocketId;
    this.username = username;

    this._onPeerJoined = this.handlePeerJoined.bind(this);
    this._onPeerLeft   = this.handlePeerLeft.bind(this);
    this._onOffer      = this.handleOffer.bind(this);
    this._onAnswer     = this.handleAnswer.bind(this);
    this._onIce        = this.handleIce.bind(this);
  }

  // ================================================================
  // Public API
  // ================================================================

  async init(): Promise<void> {
    if (this.destroyed) return;
    this.onStatusChange?.("connecting");

    if (!this.socket.connected) {
      this.onStatusChange?.("error");
      throw new Error(
        "Not connected to the game server. Please refresh the page and try again."
      );
    }

    // 1. Fetch ICE config from server (STUN + optional TURN)
    this.iceServers = await this.fetchIceConfig();

    // 2. Request microphone with quality constraints
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: AUDIO_CONSTRAINTS,
        video: false,
      });
    } catch {
      this.onPermissionChange?.("denied");
      this.onStatusChange?.("error");
      throw new Error(
        "Microphone access denied. Please allow microphone access in your browser settings."
      );
    }

    this.onPermissionChange?.("granted");

    if (this.destroyed) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }

    this.localStream = stream;

    // 3. Local speaking detection — uses AnalyserNode, never toggles track.enabled
    try {
      this.localAudioCtx = new AudioContext();
      this.localAnalyser = createAnalyser(stream, this.localAudioCtx);
    } catch {
      // AudioContext unavailable — speaking detection skipped
    }

    // 4. Register signal handlers before voice:join to avoid race conditions
    this.socket.on("voice:peer-joined", this._onPeerJoined);
    this.socket.on("voice:peer-left",   this._onPeerLeft);
    this.socket.on("voice:offer",       this._onOffer);
    this.socket.on("voice:answer",      this._onAnswer);
    this.socket.on("voice:ice",         this._onIce);

    // 5. Join voice room — ack returns existing peers
    const VOICE_JOIN_TIMEOUT_MS = 8000;
    type VoicePeerInfo = Array<{ socketId: string; username: string }>;

    const joinPromise = new Promise<VoicePeerInfo>((resolve, reject) => {
      this.socket.emit(
        "voice:join",
        { roomCode: this.roomCode, username: this.username },
        (res) => {
          if (res.success) resolve(res.peers);
          else reject(new Error(res.error));
        }
      );
    });
    const timeoutPromise = new Promise<VoicePeerInfo>((_, reject) =>
      setTimeout(
        () => reject(new Error("Voice connection timed out. Check your network and try again.")),
        VOICE_JOIN_TIMEOUT_MS
      )
    );

    const existingPeers = await Promise.race([joinPromise, timeoutPromise]);

    if (this.destroyed) return;

    // 6. Track voice participants (self + existing)
    this.voiceParticipantIds.add(this.mySocketId);
    for (const peer of existingPeers) {
      this.voiceParticipantIds.add(peer.socketId);
    }
    this.onVoiceParticipantsChange?.(new Set(this.voiceParticipantIds));

    // 7. As the new joiner, send offers to all existing peers
    for (const peer of existingPeers) {
      await this.sendOffer(peer.socketId);
      if (this.destroyed) return;
    }

    // 8. Start speaking detection + health monitoring loops
    this.startSpeakingDetection();
    this.startHealthMonitor();

    this.onStatusChange?.("connected");
  }

  mute(): void {
    this.localStream?.getAudioTracks().forEach((t) => {
      t.enabled = false;
    });
  }

  unmute(): void {
    this.localStream?.getAudioTracks().forEach((t) => {
      t.enabled = true;
    });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;

    if (this.speakingTimer !== null) {
      clearInterval(this.speakingTimer);
      this.speakingTimer = null;
    }
    if (this.healthTimer !== null) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }

    if (this.localAudioCtx) {
      try { this.localAudioCtx.close(); } catch { /* ignore */ }
      this.localAudioCtx = null;
    }
    this.localAnalyser = null;

    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;

    for (const [, state] of this.peers) {
      if (state.iceRestartTimer !== null) clearTimeout(state.iceRestartTimer);
      state.pc.close();
      if (state.audioCtx) {
        try { state.audioCtx.close(); } catch { /* ignore */ }
      }
      state.audioEl.pause();
      state.audioEl.srcObject = null;
      state.audioEl.remove();
    }
    this.peers.clear();

    this.socket.off("voice:peer-joined", this._onPeerJoined);
    this.socket.off("voice:peer-left",   this._onPeerLeft);
    this.socket.off("voice:offer",       this._onOffer);
    this.socket.off("voice:answer",      this._onAnswer);
    this.socket.off("voice:ice",         this._onIce);

    this.socket.emit("voice:leave", { roomCode: this.roomCode }, () => {});
  }

  // ================================================================
  // Private: ICE config fetch (Phase 6A)
  // ================================================================

  private fetchIceConfig(): Promise<RTCIceServer[]> {
    const fallback: RTCIceServer[] = [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
    ];

    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(fallback), 4000);

      this.socket.emit("voice:ice-config:get", (res) => {
        clearTimeout(timer);
        if (res.success && res.iceServers?.length > 0) {
          resolve(res.iceServers);
        } else {
          resolve(fallback);
        }
      });
    });
  }

  // ================================================================
  // Private: peer connection helpers
  // ================================================================

  private createPeerConnection(remoteSocketId: string): RTCPeerConnection {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });

    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => pc.addTrack(t, this.localStream!));
    }

    pc.onicecandidate = ({ candidate }) => {
      if (candidate && !this.destroyed) {
        this.socket.emit(
          "voice:ice",
          { roomCode: this.roomCode, toSocketId: remoteSocketId, candidate: candidate.toJSON() },
          () => {}
        );
      }
    };

    pc.ontrack = (e) => {
      const state = this.peers.get(remoteSocketId);
      if (!state) return;
      const stream = e.streams[0];
      if (!stream) return;
      state.audioEl.srcObject = stream;
      state.audioEl.play().catch(() => {});

      try {
        if (!state.audioCtx) {
          state.audioCtx = new AudioContext();
          state.analyser = createAnalyser(stream, state.audioCtx);
        }
      } catch { /* AudioContext unavailable */ }
    };

    // Phase 6C: ICE restart on "failed"
    pc.oniceconnectionstatechange = () => {
      const state = this.peers.get(remoteSocketId);
      if (!state) return;

      const iceState = pc.iceConnectionState;

      if (iceState === "failed") {
        this.onPeerHealthChange?.(remoteSocketId, { quality: "failed", roundTripMs: null });

        // The "polite" peer (lower socket ID) initiates ICE restart to avoid
        // both sides trying simultaneously. 3 s delay gives the other side
        // time to detect the failure too.
        const isPolite = this.mySocketId < remoteSocketId;
        if (isPolite && state.iceRestartTimer === null) {
          state.iceRestartTimer = setTimeout(async () => {
            state.iceRestartTimer = null;
            if (this.destroyed) return;
            const current = this.peers.get(remoteSocketId);
            if (!current || current.pc.iceConnectionState === "connected") return;

            this.onStatusChange?.("reconnecting");
            try {
              const offer = await current.pc.createOffer({ iceRestart: true });
              await current.pc.setLocalDescription(offer);
              if (this.destroyed) return;
              this.socket.emit(
                "voice:offer",
                { roomCode: this.roomCode, toSocketId: remoteSocketId, offer: current.pc.localDescription! },
                () => {}
              );
            } catch (err) {
              console.warn("[VoiceClient] ICE restart failed:", err);
            }
          }, ICE_RESTART_DELAY_MS);
        }
      } else if (iceState === "connected" || iceState === "completed") {
        // Clear pending restart timer if connection recovered on its own
        if (state.iceRestartTimer !== null) {
          clearTimeout(state.iceRestartTimer);
          state.iceRestartTimer = null;
        }
        // Restore status to connected if we were reconnecting
        if (!this.destroyed) {
          this.onStatusChange?.("connected");
        }
      }
    };

    return pc;
  }

  private createAudioElement(remoteSocketId: string): HTMLAudioElement {
    const el = document.createElement("audio");
    el.autoplay = true;
    el.setAttribute("data-voice-peer", remoteSocketId);
    el.style.display = "none";
    document.body.appendChild(el);
    return el;
  }

  private async sendOffer(remoteSocketId: string): Promise<void> {
    if (this.destroyed) return;

    const audioEl = this.createAudioElement(remoteSocketId);
    const pc = this.createPeerConnection(remoteSocketId);
    this.peers.set(remoteSocketId, { pc, audioEl, analyser: null, audioCtx: null, iceRestartTimer: null });

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      if (this.destroyed) return;

      await new Promise<void>((resolve, reject) => {
        this.socket.emit(
          "voice:offer",
          { roomCode: this.roomCode, toSocketId: remoteSocketId, offer: pc.localDescription! },
          (res) => { if (res.success) resolve(); else reject(new Error(res.error)); }
        );
      });
    } catch (err) {
      console.warn("[VoiceClient] sendOffer error:", err);
    }
  }

  // ================================================================
  // Private: signal event handlers
  // ================================================================

  private handlePeerJoined({ socketId }: { socketId: string; username: string }): void {
    if (this.destroyed || socketId === this.mySocketId) return;
    this.voiceParticipantIds.add(socketId);
    this.onVoiceParticipantsChange?.(new Set(this.voiceParticipantIds));
  }

  private handlePeerLeft({ socketId }: { socketId: string }): void {
    if (this.destroyed) return;

    const state = this.peers.get(socketId);
    if (state) {
      if (state.iceRestartTimer !== null) clearTimeout(state.iceRestartTimer);
      state.pc.close();
      if (state.audioCtx) {
        try { state.audioCtx.close(); } catch { /* ignore */ }
      }
      state.audioEl.pause();
      state.audioEl.srcObject = null;
      state.audioEl.remove();
      this.peers.delete(socketId);
    }

    this.voiceParticipantIds.delete(socketId);
    this.onSpeakingChange?.(socketId, false);
    this.onVoiceParticipantsChange?.(new Set(this.voiceParticipantIds));
  }

  private async handleOffer({
    fromSocketId,
    offer,
  }: { fromSocketId: string; offer: RTCSessionDescriptionInit }): Promise<void> {
    if (this.destroyed || fromSocketId === this.mySocketId) return;

    let state = this.peers.get(fromSocketId);
    if (!state) {
      const audioEl = this.createAudioElement(fromSocketId);
      const pc = this.createPeerConnection(fromSocketId);
      state = { pc, audioEl, analyser: null, audioCtx: null, iceRestartTimer: null };
      this.peers.set(fromSocketId, state);
    }

    try {
      await state.pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await state.pc.createAnswer();
      await state.pc.setLocalDescription(answer);
      if (this.destroyed) return;

      this.socket.emit(
        "voice:answer",
        { roomCode: this.roomCode, toSocketId: fromSocketId, answer: state.pc.localDescription! },
        () => {}
      );
    } catch (err) {
      console.warn("[VoiceClient] handleOffer error:", err);
    }
  }

  private async handleAnswer({
    fromSocketId,
    answer,
  }: { fromSocketId: string; answer: RTCSessionDescriptionInit }): Promise<void> {
    if (this.destroyed) return;
    const state = this.peers.get(fromSocketId);
    if (!state) return;
    try {
      await state.pc.setRemoteDescription(new RTCSessionDescription(answer));
    } catch (err) {
      console.warn("[VoiceClient] handleAnswer error:", err);
    }
  }

  private async handleIce({
    fromSocketId,
    candidate,
  }: { fromSocketId: string; candidate: RTCIceCandidateInit }): Promise<void> {
    if (this.destroyed) return;
    const state = this.peers.get(fromSocketId);
    if (!state) return;
    try {
      await state.pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.warn("[VoiceClient] handleIce error:", err);
    }
  }

  // ================================================================
  // Private: speaking detection (Phase D — never toggles track.enabled)
  // ================================================================

  private startSpeakingDetection(): void {
    this.speakingTimer = setInterval(() => {
      if (this.destroyed) return;

      if (this.localAnalyser) {
        const speaking = isSpeakingNow(this.localAnalyser);
        if (speaking !== this.localSpeaking) {
          this.localSpeaking = speaking;
          this.onSpeakingChange?.(this.mySocketId, speaking);
        }
      }

      for (const [socketId, state] of this.peers) {
        if (state.analyser) {
          const speaking = isSpeakingNow(state.analyser);
          this.onSpeakingChange?.(socketId, speaking);
        }
      }
    }, SPEAKING_POLL_MS);
  }

  // ================================================================
  // Private: health monitoring (Phase 6B)
  // ================================================================

  private startHealthMonitor(): void {
    this.healthTimer = setInterval(() => {
      if (this.destroyed) return;
      for (const [socketId, state] of this.peers) {
        this.pollPeerHealth(socketId, state);
      }
    }, HEALTH_POLL_MS);
  }

  private pollPeerHealth(socketId: string, state: PeerState): void {
    const iceState = state.pc.iceConnectionState;

    // Use iceConnectionState as the primary quality signal.
    // getStats RTT adds precision but getStats is async — we fire-and-forget
    // so it never blocks the interval.
    let quality: PeerQuality;
    if (iceState === "connected" || iceState === "completed") {
      quality = "connected";
    } else if (iceState === "checking" || iceState === "new") {
      quality = "connecting";
    } else if (iceState === "disconnected") {
      quality = "degraded";
    } else {
      quality = "failed";
    }

    // Fire-and-forget getStats for RTT
    state.pc.getStats().then((stats) => {
      if (this.destroyed) return;
      let roundTripMs: number | null = null;

      stats.forEach((report) => {
        if (
          report.type === "candidate-pair" &&
          // Only "succeeded" pairs have a valid RTT
          (report as RTCIceCandidatePairStats).state === "succeeded" &&
          (report as RTCIceCandidatePairStats).currentRoundTripTime != null
        ) {
          const rtt = (report as RTCIceCandidatePairStats).currentRoundTripTime!;
          roundTripMs = Math.round(rtt * 1000);
          // Downgrade to degraded if RTT is very high (> 500 ms)
          if (quality === "connected" && roundTripMs > 500) {
            quality = "degraded";
          }
        }
      });

      this.onPeerHealthChange?.(socketId, { quality, roundTripMs });
    }).catch(() => {
      // getStats not available on this browser — still report ICE-state quality
      this.onPeerHealthChange?.(socketId, { quality, roundTripMs: null });
    });
  }
}
