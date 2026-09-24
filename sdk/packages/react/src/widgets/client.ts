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
// full markdown renderer; the reader page does). Drops heading/quote/list markers + common inline
// emphasis, and — the part that matters for a clean preview — turns markdown/wiki LINKS into their
// text so `[corpus](/wiki/…)` reads as "corpus", not raw markup. Good enough for a preview; the
// full note is one click away.
export function stripMarkdown(line: string): string {
  return line
    .replace(/^(?:\s*>)+\s?/, '')                     // nested blockquote markers (> and > >)
    .replace(/^#{1,6}\s+/, '')                        // heading
    .replace(/^[-*]\s+/, '')                          // list bullet
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')             // image → drop
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')          // [text](url) → text
    .replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, '$1') // [[wikilink|alias]] → text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1');
}

// isStructural —— a block that is metadata / scaffolding, not prose: a code fence (```mermaid …),
// an Obsidian callout marker ([!i18n] / [!lang]), inline HTML (the i18n radio <label>…), or a wiki
// nav/frontmatter line (Parent: / Up: / Repo: …). These must not leak into an inline preview.
function isStructural(raw: string, stripped: string): boolean {
  const r = raw.trim();
  if (r.startsWith('```')) return true;
  if (stripped.includes('[!')) return true;
  if (/<\/?[a-zA-Z][^>]*>/.test(r)) return true;
  if (/^(Parent|Up|Repo|Status|Tags|Aliases|Children)\s*[:：]/.test(stripped)) return true;
  return false;
}

// paragraphsOf —— split a body into stripped prose paragraphs (blank-line separated), dropping
// structural/metadata blocks, capped so an inline reveal stays a preview, not a wall.
export function paragraphsOf(body: string, max: number): string[] {
  const out: string[] = [];
  for (const block of body.split(/\n\s*\n/)) {
    const stripped = stripMarkdown(block.replace(/\n/g, ' ')).trim();
    if (stripped === '' || isStructural(block, stripped)) continue;
    out.push(stripped);
    if (out.length >= max) break;
  }
  return out;
}
