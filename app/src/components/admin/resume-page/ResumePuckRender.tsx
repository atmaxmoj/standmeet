// ResumePuckRender —— the résumé rendered by Puck's own `<Render>`, from the SAME config as the
// editor (resume-puck-config). This is the single renderer (A3): what the owner arranges in the Puck
// editor is exactly what prints — no second renderer to drift from it. gotenberg's Chromium loads the
// print route, which SSRs this component; metadata carries the real per-application QR + the print
// flag (so the root renders a flowing page for @page pagination, not the editor's A4 desk).

'use client';

import { Render, type Data } from '@measured/puck';
import '@measured/puck/puck.css';

import { resumePuckConfig } from '@/lib/admin/resume-puck-config';
import { toPuckData } from '@/lib/admin/resume-puck';
import type { ResumeContent } from '@/lib/admin/resume-content';

export function ResumePuckRender(
  { content, qrURL }: { content: ResumeContent; qrURL: string },
) {
  // toPuckData is the same projection the editor opens with; cast at this boundary (the projection is
  // Puck-runtime-free + unit-tested).
  const data = toPuckData(content) as unknown as Data; // eslint-disable-line @typescript-eslint/consistent-type-assertions
  return <Render config={resumePuckConfig} data={data} metadata={{ qrURL, print: true }} />;
}
