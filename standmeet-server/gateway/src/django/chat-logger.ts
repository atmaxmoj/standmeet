export async function logChat(
  djangoUrl: string,
  ownerToken: string,
  inviteCode: string,
  userMessage: string,
  assistantMessage: string,
  sessionId?: string,
  sources?: string[],
): Promise<void> {
  const body: Record<string, unknown> = {
    invite_code: inviteCode,
    user_message: userMessage,
    assistant_message: assistantMessage,
  };
  if (sessionId) {
    body.session_id = sessionId;
  }
  if (sources?.length) {
    body.sources = sources;
  }
  const res = await fetch(`${djangoUrl}/api/internal/chat-log/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ownerToken}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    console.error(`Failed to log chat (${res.status}): ${await res.text()}`);
  }
}
