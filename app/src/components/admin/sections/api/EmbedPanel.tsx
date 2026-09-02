// EmbedPanel — the two lines needed to put this instance's chat on
// **someone else's website**.
//
// **Why this block has to exist**: CLAUDE.md promises embed is a "single
// `<script>` tag drop-in", but before this block, owner had no place in the
// product to see what that tag looked like — and `/embed.js` was still a 404
// at the time (verified live 2026-08-30). The promise was in the docs, the
// bundle built fine, and the piece in between just didn't exist.
//
// The address is **computed at runtime**, never hardcoded: owner's instance
// runs on his own domain, so a hardcoded localhost would mean the code he
// copies onto his own site never points back at him. And the e2e test pulls
// src out of this exact snippet to visit it — a "we remember there's an
// /embed.js" assertion that would silently verify the wrong thing if the
// path ever changed ([[ref-resolves-not-a-string]]).

'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

// EMBED_PATH — served from app/public/embed.js (put there by
// scripts/copy-embed-bundle.mjs); next.config's headers open CORS for it.
const EMBED_PATH = '/embed.js';

export function EmbedPanel() {
  const t = useTranslations('adminIntegrations.embed');
  const [origin, setOrigin] = useState('');
  // Only the browser knows this instance's outward-facing address. Left
  // blank during SSR, which still renders a correct relative path.
  useEffect(() => { setOrigin(window.location.origin); }, []);
  return (
    <section>
      <h2 className="font-serif text-(--color-ink) text-[22px] font-medium tracking-[-0.012em] mb-2">
        {t('heading')}
      </h2>
      <p className="reading-tight text-(--color-muted) text-[15px] max-w-[54em] mb-3">
        {t('blurb')}
      </p>
      <pre
        data-testid="embed-snippet"
        className="mono text-[12px] text-(--color-ink) bg-(--color-rule)/20 border border-(--color-rule) rounded-[3px] p-3 overflow-x-auto"
      >{snippet(origin)}</pre>
    </section>
  );
}

// snippet — the two lines owner copies out. The second line matters just as
// much: give him only the <script> tag, and he still won't know what to
// write on the page after that.
function snippet(origin: string): string {
  return [
    `<script src="${origin}${EMBED_PATH}"></script>`,
    `<standmeet-chat base-url="${origin}" mode="public"></standmeet-chat>`,
  ].join('\n');
}
