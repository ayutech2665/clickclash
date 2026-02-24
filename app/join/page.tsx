// "/join" — Join Room page (Phase 2)
//
// Flow:
//   1. User enters username + room code
//      (room code can be pre-filled via ?code= query param from a shared link)
//   2. Click "Join Room" → connect socket → emit room:join
//   3. Server returns { roomCode, playerId, hostId, state }
//   4. Save session to sessionStorage
//   5. Navigate to /room/[code]
//
// The server's room:join handles both new joins and reconnects — if a player
// with the same username is already in the room, their socket.id is updated.
//
// NOTE: useSearchParams() must be inside a Suspense boundary per Next.js App
// Router rules. The outer export wraps the inner component in <Suspense>.

"use client";

import { Suspense, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import PageShell from "@/components/PageShell";
import HeaderBar from "@/components/HeaderBar";
import CrayonCard from "@/components/CrayonCard";
import CrayonButton from "@/components/CrayonButton";
import CrayonInput from "@/components/CrayonInput";
import { ToastContainer, useToast } from "@/components/Toast";
import { validateUsername, validateRoomCode, sanitizeUsername } from "@/lib/utils";
import { ensureConnected, saveSession } from "@/lib/socket";

// Inner component that uses useSearchParams — must be inside Suspense.
function JoinRoomInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toasts, addToast, dismissToast } = useToast();

  // Pre-fill room code if shared via link (?code=XXXXXX)
  const [username, setUsername] = useState("");
  const [roomCode, setRoomCode] = useState(
    (searchParams.get("code") ?? "").toUpperCase()
  );
  const [errors, setErrors] = useState<{ username?: string; roomCode?: string }>({});
  const [isJoining, setIsJoining] = useState(false);

  // If ?code= param appears after mount (e.g. navigation), sync it
  useEffect(() => {
    const code = searchParams.get("code");
    if (code && !roomCode) setRoomCode(code.toUpperCase());
  }, [searchParams, roomCode]);

  function validate(): boolean {
    const nameErr = validateUsername(sanitizeUsername(username));
    const codeErr = validateRoomCode(roomCode.trim());
    setErrors({ username: nameErr ?? undefined, roomCode: codeErr ?? undefined });
    return !nameErr && !codeErr;
  }

  async function handleJoin() {
    if (!validate()) return;
    setIsJoining(true);

    const cleanName = sanitizeUsername(username);
    const cleanCode = roomCode.trim().toUpperCase();

    try {
      const socket = await ensureConnected();

      const result = await new Promise<{
        roomCode: string;
        playerId: string;
        hostId: string;
      }>((resolve, reject) => {
        socket.emit("room:join", { roomCode: cleanCode, username: cleanName }, (res) => {
          if (res.success) resolve(res);
          else reject(new Error(res.error));
        });
      });

      saveSession({
        playerId: result.playerId,
        username: cleanName,
        roomCode: result.roomCode,
        hostId: result.hostId,
      });

      router.push(`/room/${result.roomCode}`);
    } catch (err) {
      addToast((err as Error).message, "error");
      setIsJoining(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") handleJoin();
  }

  return (
    <>
      <HeaderBar />
      <PageShell>
        <Link
          href="/"
          className="mt-6 inline-flex items-center gap-1 text-sm font-bold underline-offset-2 hover:underline"
          style={{ color: "var(--color-muted)" }}
        >
          ← Back to home
        </Link>

        <h1 className="mb-6 mt-3" style={{ color: "var(--color-ink)" }}>
          Enter a Room
        </h1>

        <CrayonCard className="flex flex-col gap-5">
          <CrayonInput
            label="Your Name"
            placeholder="e.g. QuizChampion"
            value={username}
            onChange={(e) => {
              setUsername(e.target.value);
              if (errors.username) setErrors((p) => ({ ...p, username: undefined }));
            }}
            onKeyDown={handleKeyDown}
            error={errors.username}
            helperText="2–20 characters."
            maxLength={20}
            autoFocus
            autoComplete="off"
            disabled={isJoining}
          />

          <CrayonInput
            label="Room Code"
            placeholder="e.g. K4X9PL"
            value={roomCode}
            onChange={(e) => {
              setRoomCode(e.target.value);
              if (errors.roomCode) setErrors((p) => ({ ...p, roomCode: undefined }));
            }}
            onKeyDown={handleKeyDown}
            error={errors.roomCode}
            helperText="6-character code shared by the room host."
            maxLength={6}
            uppercase
            autoComplete="off"
            inputMode="text"
            disabled={isJoining}
          />

          <CrayonCard variant="muted" className="py-3 text-sm">
            <p style={{ color: "var(--color-muted)" }}>
              💡 Ask the room host to share the 6-character code or the room link.
            </p>
          </CrayonCard>

          <CrayonButton
            variant="secondary"
            size="lg"
            fullWidth
            onClick={handleJoin}
            disabled={isJoining}
            aria-busy={isJoining}
          >
            {isJoining ? "Joining…" : "🔑 Join Room"}
          </CrayonButton>
        </CrayonCard>

        <p className="mt-5 text-center text-sm" style={{ color: "var(--color-muted)" }}>
          Don&apos;t have a room?{" "}
          <Link
            href="/create"
            className="font-bold underline underline-offset-2"
            style={{ color: "var(--color-ink)" }}
          >
            Create one
          </Link>
        </p>
      </PageShell>

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}

// Outer export wraps the inner component in a Suspense boundary,
// required by Next.js App Router whenever useSearchParams() is used.
export default function JoinRoomPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <div
            className="h-10 w-10 animate-spin rounded-full border-4"
            style={{ borderColor: "var(--color-yellow)", borderTopColor: "transparent" }}
            aria-label="Loading…"
          />
        </div>
      }
    >
      <JoinRoomInner />
    </Suspense>
  );
}
