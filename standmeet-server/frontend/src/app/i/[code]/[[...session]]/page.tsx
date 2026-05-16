"use client";

import { use } from "react";
import { ChatBox } from "@/components/chat-box";

interface Props {
  params: Promise<{ code: string; session?: string[] }>;
}

export default function InvitePage({ params }: Props) {
  const { code, session } = use(params);
  const sessionId = session?.[0] ?? undefined;

  return (
    <main className="chat-page">
      <ChatBox
        inviteCode={code}
        sessionId={sessionId}
        onBack={() => { window.location.href = "/"; }}
      />
    </main>
  );
}
