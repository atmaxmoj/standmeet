// /live/[token] — the owner's live transcript of one conversation, opened from the link on a
// notification card (docs/design/notify-rules-and-live-transcript.md). No sign-in: the signed,
// expiring token in the path is the credential, and the backend refuses anything else. The chat
// lives in the SDK; this route only hands it the token.

import { LiveTranscript } from '@standmeet/sdk';

interface PageProps {
  params: Promise<{ token: string }>;
}

export default async function Page({ params }: PageProps) {
  const { token } = await params;
  return <LiveTranscript token={token} />;
}
