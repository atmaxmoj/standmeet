"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { InviteInput } from "@/components/invite-input";
import { ConnectGuide } from "@/components/connect-guide";
import { getMcpUrl, validateInviteCode } from "@/lib/api-client";

export default function Home() {
  const router = useRouter();
  const [showInvite, setShowInvite] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [isValidating, setIsValidating] = useState(false);

  const handleInviteSubmit = async (code: string) => {
    setInviteError(null);
    setIsValidating(true);
    try {
      const result = await validateInviteCode(code);
      if (result.ok) {
        // Navigate with session_id so chat page can resume the session
        router.push(`/i/${encodeURIComponent(code)}/${result.sessionId}`);
      } else {
        setInviteError(result.error);
        setIsValidating(false);
      }
    } catch {
      setInviteError("Something went wrong. Please try again.");
      setIsValidating(false);
    }
  };

  return (
    <main
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        padding: "20px",
        gap: "48px",
      }}
    >
      <h1>StandMeet</h1>

      <ConnectGuide mcpUrl={getMcpUrl()} />

      <div style={{ textAlign: "center" }}>
        {showInvite ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "12px",
            }}
          >
            <InviteInput
              onSubmit={handleInviteSubmit}
              error={inviteError}
              isLoading={isValidating}
            />
            <button
              onClick={() => { setShowInvite(false); setInviteError(null); }}
              disabled={isValidating}
              style={{
                background: "none",
                border: "none",
                color: "#999",
                cursor: isValidating ? "not-allowed" : "pointer",
                fontSize: "13px",
              }}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowInvite(true)}
            style={{
              background: "none",
              border: "none",
              color: "#666",
              cursor: "pointer",
              fontSize: "14px",
              textDecoration: "underline",
            }}
          >
            Have an invite code?
          </button>
        )}
      </div>
    </main>
  );
}
