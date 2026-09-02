// tikz.ts — server-side usecase for TikZ source → SVG (node-tikzjax = same engine as
// obsidian-tikzjax).
// **Import only on the server** (route.ts); the heavy WASM TeX engine must not ship in
// the client bundle.

import tex2svg from 'node-tikzjax';
import { z } from 'zod';

const TikzReqSchema = z.object({ source: z.string().min(1).max(20_000) });

export interface TikzResult {
  status: number;
  payload: { svg?: string; error?: string };
}

// renderTikz — validate + render; returns status + payload, which the controller
// passes straight through.
export async function renderTikz(raw: unknown): Promise<TikzResult> {
  const parsed = TikzReqSchema.safeParse(raw);
  return parsed.success
    ? renderValidated(parsed.data.source)
    : Promise.resolve({ status: 400, payload: { error: 'invalid source' } });
}

const RENDER_TIMEOUT_MS = 25_000;

// FONT_CSS_URL — in this SVG output, text is `<text>` + `font-family: cmr10 / cmsy10 / …`,
// and the characters are **slots in the TeX fonts**, not Unicode: `$\to$` lands at 0x21 in
// cmsy10, which is `!`. If the font doesn't load, the browser falls back to a system font,
// the arrow instantly becomes an exclamation mark, kerning is computed from the wrong
// metrics, and words get split apart (`stochastic` → `sto chastic`).
//
// The package's `embedFontCss` defaults to false, and its default fontCssUrl still points
// at jsDelivr. This is a **self-hosted** product: an offline instance can't reach it, and
// every diagram would fire a third-party request on behalf of the owner's readers. So the
// fonts are served by this instance instead (scripts/copy-tikz-fonts.mjs copies them into
// public/ as part of the build).
const FONT_CSS_URL = '/tikz-fonts/fonts.css';

// wrapDocument — a tikz block in the reader is just `\begin{tikzpicture}…`; node-tikzjax
// needs the full `\begin{document}…\end{document}` (it supplies documentclass/preamble).
// If it's already a full document, don't wrap it again.
function wrapDocument(source: string): string {
  return source.includes('\\begin{document}')
    ? source
    : `\\begin{document}\n${source}\n\\end{document}`;
}

// queue — node-tikzjax's WASM TeX engine is a **per-process singleton**, not reentrant:
// two renders entering at once trample each other and both throw
// `TeX engine render failed`. Verified in production: sending the same source once gets
// 200, sending it twice concurrently gets 422 on both (returns in 0.6s, doesn't even
// reach the timeout).
//
// And **a page with several diagrams fires that many requests at once from the browser** —
// so the reader sees "some diagrams rendered, others show a wall of raw LaTeX source", and
// which ones fail is essentially random. The more diagrams, the more likely a collision.
// So serializing isn't a performance tweak — it's a hard requirement of this engine.
//
// ponytail: one queue per process. Multiple processes/replicas each serialize
// independently, which is fine since the singleton is process-local anyway; add a shared
// lock only if cross-replica throttling is actually needed.
let queue: Promise<unknown> = Promise.resolve();

function renderValidated(source: string): Promise<TikzResult> {
  const run = queue.then(() => renderExclusive(source));
  // The queue only sequences work, it doesn't propagate failure — one render crashing
  // shouldn't take down every diagram queued behind it.
  queue = run.catch(() => undefined);
  return run;
}

// renderExclusive — the timer starts from the moment it **actually starts running**,
// excluding queue wait time: otherwise, on a page with many diagrams, one that hasn't
// gotten its turn yet would be judged timed out before it even started.
function renderExclusive(source: string): Promise<TikzResult> {
  const rendered = tex2svg(wrapDocument(source), {
    showConsole: false, embedFontCss: true, fontCssUrl: FONT_CSS_URL,
  })
    .then((svg): TikzResult => ({ status: 200, payload: { svg } }));
  return Promise.race([rendered, timeout(RENDER_TIMEOUT_MS)])
    .catch((e: unknown): TikzResult => ({
      status: 422,
      payload: { error: e instanceof Error ? e.message : 'render failed' },
    }));
}

// timeout — don't let the request hang forever if the TeX engine cold-starts or assets
// are missing; on timeout, degrade to an error (client falls back to showing the source).
function timeout(ms: number): Promise<TikzResult> {
  return new Promise((_resolve, reject) => {
    setTimeout(() => reject(new Error('tikz render timeout')), ms);
  });
}
