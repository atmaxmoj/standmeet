// client.ts —— the shared pieces every site widget uses.
//
// The widgets are the central, managed set of drop-in blocks a microsite composes (a corpus
// browser, an agent entry, a gate CTA, a nav to the owner's other pages) — so a page author
// never hand-writes them. They all talk to the same-origin instance, so they share one client.

import { createClient } from '@standmeet/sdk-core';

// widgetClient —— same-origin client shared by every widget (baseURL '' = the instance serving
// the page). Module-level so all widgets on a page reuse one instance.
export const widgetClient = createClient({ baseURL: '' });

// gateHref —— a codeless visitor's agent question hands off to /gate, which continues the answer
// once they present a code / key. Empty question → the bare gate.
export function gateHref(question: string): string {
  const q = question.trim();
  return q === '' ? '/gate' : `/gate?q=${encodeURIComponent(q)}`;
}

// stripMarkdown —— a light pass so a note's raw body reads as prose inline (widgets don't ship a
// full markdown renderer; the reader page does). Drops heading/quote/list markers + common
// inline emphasis. Good enough for a preview; the full note is one click away.
export function stripMarkdown(line: string): string {
  return line
    .replace(/^#{1,6}\s+/, '')
    .replace(/^>\s+/, '')
    .replace(/^[-*]\s+/, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`(.+?)`/g, '$1');
}

// paragraphsOf —— split a body into stripped prose paragraphs (blank-line separated), capped so
// an inline reveal stays a preview, not a wall.
export function paragraphsOf(body: string, max: number): string[] {
  return body
    .split(/\n\s*\n/)
    .map((p) => stripMarkdown(p.replace(/\n/g, ' ')).trim())
    .filter((p) => p !== '')
    .slice(0, max);
}
