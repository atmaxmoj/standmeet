// transcript-export —— one conversation as a Markdown file the owner can keep, quote, or hand to
// another tool (owner, 2026-09-28: "这个 transcript 提供一个下载键吧"). Built from the transcript the
// modal already holds, so the file and the screen can never disagree: who the visitor was, then
// every message in order, with what each answer cited.

import type { CitedGenre, ConvTranscript, ConvTranscriptMessage } from '@/lib/admin/use-conversations';

const CITED_ORDER: readonly CitedGenre[] = ['output', 'wiki', 'subjectivity', 'writing'];

export function transcriptMarkdown(t: ConvTranscript): string {
  const s = t.summary;
  const head = [
    `# Conversation — ${s?.visitor ?? t.conversationID}`,
    '',
    ...(s !== null ? [`- code: ${s.code_label} (${s.code})`] : []),
    `- conversation: ${t.conversationID}`,
    '',
  ];
  return [...head, ...t.messages.flatMap((m) => messageBlock(m, t))].join('\n');
}

function messageBlock(m: ConvTranscriptMessage, t: ConvTranscript): string[] {
  const label = m.role === 'assistant' ? 'ai' : m.role === 'event' ? 'card action' : 'visitor';
  const cited = CITED_ORDER.flatMap((kind) =>
    m.cited[kind].map((id) => t.refs[kind][id]).filter((title) => title !== undefined)
      .map((title) => `- cited · ${kind} · ${title}`));
  return [`## ${label} · ${m.created_at}`, '', m.body, '', ...(cited.length > 0 ? [...cited, ''] : [])];
}

// transcriptFilename —— transcript-<visitor>-<conversation id prefix>.md, safe on any filesystem.
export function transcriptFilename(t: ConvTranscript): string {
  const who = (t.summary?.visitor ?? 'visitor').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `transcript-${who || 'visitor'}-${t.conversationID.slice(0, 8)}.md`;
}

// downloadTranscript —— hand the file to the browser.
export function downloadTranscript(t: ConvTranscript): void {
  const url = URL.createObjectURL(new Blob([transcriptMarkdown(t)], { type: 'text/markdown' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = transcriptFilename(t);
  a.click();
  URL.revokeObjectURL(url);
}
