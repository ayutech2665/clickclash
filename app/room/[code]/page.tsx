// "/room/[code]" — Room Lobby (Phase 4 / Voice auto-on)
//
// Voice is initialized automatically after room:join succeeds.
// The VoiceClient lives in VoiceContext (room layout), so it persists
// when the host starts the game and the page navigates to /play.

"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import PageShell from "@/components/PageShell";
import HeaderBar from "@/components/HeaderBar";
import CrayonCard from "@/components/CrayonCard";
import CrayonButton from "@/components/CrayonButton";
import PlayerAvatarCard from "@/components/PlayerAvatarCard";
import VoiceBar from "@/components/VoiceBar";
import { ToastContainer, useToast } from "@/components/Toast";
import { copyToClipboard } from "@/lib/utils";
import { getSocket, ensureConnected, loadSession, saveSession, clearSession } from "@/lib/socket";
import { toDisplayPlayers } from "@/lib/types";
import { CATEGORIES } from "@/lib/categories";
import { useVoiceControls, useVoiceActivity } from "@/lib/voice/VoiceContext";
import type { RoomPublicState, Player } from "@/lib/types";

type PageState = "connecting" | "lobby" | "expired" | "connect_error";

export default function RoomLobbyPage() {
  const params  = useParams();
  const router  = useRouter();
  const code    = (params.code as string).toUpperCase();
  const { toasts, addToast, dismissToast } = useToast();
  const { initVoice } = useVoiceControls();
  const { speakingIds } = useVoiceActivity();

  const [pageState, setPageState]           = useState<PageState>("connecting");
  const [roomState, setRoomState]           = useState<RoomPublicState | null>(null);
  const [displayPlayers, setDisplayPlayers] = useState<Player[]>([]);
  const [mySocketId, setMySocketId]         = useState<string>("");
  const [myUsername, setMyUsername]         = useState<string>("");
  const [startError, setStartError]         = useState<string>("");
  const [isStarting, setIsStarting]         = useState(false);
  const hasConnected = useRef(false);

  const isHost = !!roomState && roomState.hostId === mySocketId;
  const canStart =
    isHost &&
    !!roomState &&
    roomState.players.length >= 2 &&
    roomState.status === "lobby";

  // ---- Auto-start voice once we have identity ----
  useEffect(() => {
    if (!mySocketId || !myUsername) return;
    initVoice(mySocketId, myUsername);
  }, [mySocketId, myUsername, initVoice]);

  // ---- Connect + join room on mount ----
  useEffect(() => {
    if (hasConnected.current) return;
    hasConnected.current = true;

    async function connect() {
      const session = loadSession();

      if (!session) {
        router.replace(`/join?code=${code}`);
        return;
      }
      if (session.roomCode !== code) {
        clearSession();
        router.replace(`/join?code=${code}`);
        return;
      }

      try {
        const socket = await ensureConnected();
        setMySocketId(socket.id ?? "");
        setMyUsername(session.username);

        socket.on("room:updated", (state) => {
          setRoomState(state);
          setDisplayPlayers(toDisplayPlayers(state.players));
          setMySocketId(socket.id ?? "");
        });

        socket.on("game:started", () => {
          router.push(`/room/${code}/play`);
        });

        const result = await new Promise<{
          roomCode: string; playerId: string; hostId: string; state: RoomPublicState;
        }>((resolve, reject) => {
          socket.emit(
            "room:join",
            { roomCode: code, username: session.username },
            (res) => {
              if (res.success) resolve(res);
              else reject(new Error(res.error));
            }
          );
        });

        saveSession({
          playerId: result.playerId,
          username: session.username,
          roomCode: result.roomCode,
          hostId: result.hostId,
        });

        setMySocketId(result.playerId);
        setMyUsername(session.username);
        setRoomState(result.state);
        setDisplayPlayers(toDisplayPlayers(result.state.players));
        setPageState("lobby");
      } catch (err) {
        console.error("[lobby] connect error:", err);
        const msg = (err as Error).message;
        setPageState(msg === "CONNECT_FAILED" ? "connect_error" : "expired");
      }
    }

    connect();

    return () => {
      const s = getSocket();
      s.off("room:updated");
      s.off("game:started");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  // ---- Copy room link ----
  const handleCopyLink = useCallback(async () => {
    const joinUrl = `${window.location.origin}/join?code=${code}`;
    const ok = await copyToClipboard(joinUrl);
    addToast(
      ok ? "Join link copied! Share it with friends." : "Could not copy — copy the URL manually.",
      ok ? "success" : "error"
    );
  }, [code, addToast]);

  // ---- Category change (host only) ----
  function handleCategoryChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const idx = parseInt(e.target.value, 10);
    const cat = CATEGORIES[idx];
    if (!cat || !roomState) return;
    const socket = getSocket();
    socket.emit(
      "room:category:set",
      { roomCode: code, categoryId: cat.id ?? null, categoryName: cat.name },
      (res) => {
        if (!res.success) addToast(res.error ?? "Could not set category.", "error");
      }
    );
  }

  // ---- Start quiz ----
  async function handleStartQuiz() {
    if (!canStart) return;
    setIsStarting(true);
    setStartError("");
    const socket = getSocket();
    socket.emit("game:start", { roomCode: code }, (res) => {
      if (!res.success) {
        setStartError(res.error ?? "Could not start the quiz.");
        setIsStarting(false);
      }
    });
  }

  // ---- Leave room ----
  function handleLeave() {
    clearSession();
    router.push("/");
  }

  // ============================================================
  // Connecting spinner
  // ============================================================
  if (pageState === "connecting") {
    return (
      <>
        <HeaderBar />
        <PageShell>
          <div className="mt-16 flex flex-col items-center gap-4">
            <div
              className="h-12 w-12 animate-spin rounded-full border-4"
              style={{ borderColor: "var(--color-yellow)", borderTopColor: "transparent" }}
              role="status"
              aria-label="Connecting…"
            />
            <p className="text-lg font-bold" style={{ color: "var(--color-muted)" }}>
              Connecting to room…
            </p>
          </div>
        </PageShell>
      </>
    );
  }

  // ============================================================
  // Connection error
  // ============================================================
  if (pageState === "connect_error") {
    return (
      <>
        <HeaderBar />
        <PageShell>
          <div className="mt-8">
            <CrayonCard variant="muted">
              <h2 className="mb-2" style={{ color: "var(--color-ink)" }}>Can&apos;t Connect</h2>
              <p className="mb-4 text-sm" style={{ color: "var(--color-muted)" }}>
                Can&apos;t connect to the game server. Refresh the page or check your network.
              </p>
              <CrayonButton variant="primary" size="md" onClick={() => window.location.reload()}>
                Refresh
              </CrayonButton>
            </CrayonCard>
          </div>
        </PageShell>
      </>
    );
  }

  // ============================================================
  // Session expired
  // ============================================================
  if (pageState === "expired") {
    return (
      <>
        <HeaderBar />
        <PageShell>
          <div className="mt-8">
            <CrayonCard variant="error">
              <h2 className="mb-2" style={{ color: "var(--color-ink)" }}>Session Expired</h2>
              <p className="mb-4 text-sm" style={{ color: "var(--color-muted)" }}>
                This room no longer exists or your session has expired. Please rejoin or create a new room.
              </p>
              <div className="flex flex-wrap gap-3">
                <Link href={`/join?code=${code}`}>
                  <CrayonButton variant="primary" size="md">🔑 Rejoin</CrayonButton>
                </Link>
                <Link href="/">
                  <CrayonButton variant="ghost" size="md">← Home</CrayonButton>
                </Link>
              </div>
            </CrayonCard>
          </div>
        </PageShell>
      </>
    );
  }

  // ============================================================
  // Main lobby
  // ============================================================
  const codeBadge = (
    <span
      className="rounded-crayon border-[2px] px-3 py-1 text-sm font-bold tracking-widest"
      style={{ background: "var(--color-paper)", borderColor: "var(--color-border)", color: "var(--color-ink)" }}
    >
      {code}
    </span>
  );

  const selectedCategoryIndex = roomState?.category
    ? CATEGORIES.findIndex(
        (c) => c.id === roomState.category?.id && c.name === roomState.category?.name
      )
    : 0;

  const hostUsername = roomState?.players.find((p) => p.isHost)?.username ?? "the host";

  // Enrich players with live speaking state from VoiceContext
  const enrichedPlayers: Player[] = displayPlayers.map((p) => ({
    ...p,
    isSpeaking: speakingIds.has(p.id),
  }));

  return (
    <>
      <HeaderBar rightSlot={codeBadge} />
      <PageShell>
        {/* ---- Room code + copy link ---- */}
        <section className="mt-6" aria-labelledby="room-code-heading">
          <CrayonCard variant="highlight" className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
                Room Code
              </p>
              <h2
                id="room-code-heading"
                className="font-bold tracking-[0.3em]"
                style={{ color: "var(--color-ink)", fontSize: "clamp(1.8rem, 7vw, 2.5rem)" }}
              >
                {code}
              </h2>
            </div>
            <CrayonButton variant="ghost" size="md" onClick={handleCopyLink} aria-label="Copy join link">
              📋 Copy Link
            </CrayonButton>
          </CrayonCard>
        </section>

        {/* ---- Voice bar (auto-on) ---- */}
        <section className="mt-4">
          <VoiceBar />
        </section>

        {/* ---- Player slots ---- */}
        <section className="mt-2" aria-labelledby="players-heading">
          <h2 id="players-heading" className="mb-3" style={{ color: "var(--color-ink)" }}>
            Players{" "}
            <span className="ml-1 text-base font-normal" style={{ color: "var(--color-muted)" }}>
              ({roomState?.players.length ?? 0}/4 joined)
            </span>
          </h2>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {enrichedPlayers.map((player, i) => (
              <PlayerAvatarCard
                key={player.id}
                player={player}
                slotNumber={i + 1}
                isYou={player.id === mySocketId}
              />
            ))}
          </div>

          {!isHost && (
            <p className="mt-3 text-center text-sm animate-soft-pulse" style={{ color: "var(--color-muted)" }}>
              Waiting for {hostUsername} to start the quiz…
            </p>
          )}
        </section>

        {/* ---- Category selection ---- */}
        <section className="mt-6" aria-labelledby="category-heading">
          <h2 id="category-heading" className="mb-3" style={{ color: "var(--color-ink)" }}>
            Category
          </h2>

          <CrayonCard>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--color-muted)" }}>
                  Selected
                </p>
                <p className="mt-0.5 text-lg font-bold" style={{ color: "var(--color-ink)" }}>
                  {roomState?.category?.name ?? "🎲 All Categories"}
                </p>
              </div>

              {isHost ? (
                <div className="relative">
                  <select
                    className="w-full appearance-none rounded-crayon border-[2.5px] px-4 py-2.5 pr-9 text-base font-crayon min-h-[44px]"
                    style={{
                      background: "var(--color-paper)",
                      borderColor: "var(--color-border)",
                      color: "var(--color-ink)",
                      boxShadow: "2px 2px 0px var(--color-border)",
                    }}
                    value={selectedCategoryIndex >= 0 ? selectedCategoryIndex : 0}
                    onChange={handleCategoryChange}
                    aria-label="Select trivia category"
                  >
                    {CATEGORIES.map((cat, idx) => (
                      <option key={idx} value={idx}>
                        {cat.name}
                      </option>
                    ))}
                  </select>
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-lg">▾</span>
                </div>
              ) : (
                <span className="text-sm" style={{ color: "var(--color-muted)" }}>Host will choose</span>
              )}
            </div>
          </CrayonCard>
        </section>

        {/* ---- Start quiz / waiting ---- */}
        <section className="mt-6" aria-labelledby="quiz-start-heading">
          <CrayonCard variant={isHost ? "default" : "muted"} className="flex flex-col gap-3">
            {isHost ? (
              <>
                <h3 id="quiz-start-heading" style={{ color: "var(--color-ink)" }}>Ready to start?</h3>
                <p className="text-sm" style={{ color: "var(--color-muted)" }}>
                  {roomState && roomState.players.length < 2
                    ? "Waiting for at least one more player to join…"
                    : "All set! Click Start Quiz to fetch questions and begin."}
                </p>

                {startError && (
                  <CrayonCard variant="error" className="py-2 text-sm font-bold">
                    ⚠ {startError}
                  </CrayonCard>
                )}

                <CrayonButton
                  variant="primary"
                  size="lg"
                  fullWidth
                  onClick={handleStartQuiz}
                  disabled={!canStart || isStarting}
                  aria-busy={isStarting}
                >
                  {isStarting ? "Fetching questions…" : "🚀 Start Quiz"}
                </CrayonButton>

                {!canStart && roomState && roomState.players.length < 2 && (
                  <p className="text-center text-xs" style={{ color: "var(--color-muted)" }}>
                    Need at least 2 players to start.
                  </p>
                )}
              </>
            ) : (
              <>
                <h3 id="quiz-start-heading" className="text-center" style={{ color: "var(--color-muted)" }}>
                  Waiting for host to start…
                </h3>
                <p className="text-center text-sm animate-soft-pulse" style={{ color: "var(--color-muted)" }}>
                  Sit tight! The quiz begins once{" "}
                  <strong style={{ color: "var(--color-ink)" }}>{hostUsername}</strong> clicks Start.
                </p>
              </>
            )}
          </CrayonCard>
        </section>

        {/* ---- Leave room ---- */}
        <div className="mt-6 flex justify-center">
          <CrayonButton variant="ghost" size="sm" onClick={handleLeave}>
            ← Leave Room
          </CrayonButton>
        </div>
      </PageShell>

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}
