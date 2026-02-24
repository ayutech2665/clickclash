// Room layout — wraps both /room/[code] (lobby) and /room/[code]/play with
// a single VoiceProvider. This keeps the VoiceClient alive across lobby ↔ play
// navigation, fixing the "one word then muting" bug caused by VoicePanel
// unmounting on every question transition.
//
// Next.js 15+: params are a Promise and must be awaited.

import { VoiceProvider } from "@/lib/voice/VoiceContext";

export default async function RoomLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  return (
    <VoiceProvider roomCode={code.toUpperCase()}>
      {children}
    </VoiceProvider>
  );
}
