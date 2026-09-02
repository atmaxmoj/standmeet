// /report/[id] — I.3: standalone route for a chat report. After the AI
// writes the HTML report, the visitor clicks "open as page ↗" in chat to
// land here; the browser renders a fullscreen iframe with a print button
// on top.
//
// Auth: the visitor session token (Bearer) is added by the client-side
// fetch (read from the stored session in localStorage). It shares the
// same session as chat (issued/reused by use-gate).
//
// SSR does not emit the HTML content (the auth header can't go in a
// query string, and the report may contain sensitive AI output). SSR
// only renders the shell; the client mount fetches the real HTML and
// feeds it to the iframe.

import { ReportArtifactPage } from '@/components/page/ReportArtifactPage';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function Page({ params }: PageProps) {
  const { id } = await params;
  return <ReportArtifactPage reportID={id} />;
}
