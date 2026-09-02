// ObsidianSection —— /admin/obsidian. The real, working import/export lives in the shared
// ObsidianBar (a vault-folder picker → POST /obsidian/import, and export → GET /obsidian/export) —
// the same component the writings section uses. This page used to be a dead mockup (a fake vault
// path + hardcoded stats + two buttons with no onClick); it now renders the real actions (F-L-1).
// No live sync / file watcher by design — two manual actions.

'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { SectionHeader } from '@/components/admin/SectionHeader';
import { ObsidianBar } from '@/components/admin/sections/writings/ObsidianBar';
import { useVaultImportState } from '@/lib/admin/use-obsidian';
import { vaultImportLine } from '@/lib/admin/vault-import-state';

export function ObsidianSection() {
  const t = useTranslations('adminCorpus.obsidian');
  // reloadKey —— re-fetches the receipt after an import completes: what's shown on
  // screen must come from **a fact that's actually been persisted**.
  const [reloadKey, setReloadKey] = useState(0);
  const importState = useVaultImportState(reloadKey);
  return (
    <>
      <SectionHeader
        kicker="integrations · vault"
        slug="obsidian"
        action={
          <span className="mono text-[10.5px] tracking-[0.16em] uppercase text-(--color-faint)">
            {t('manualMode')}
          </span>
        }
      />
      {/* This explanation used to be **inside** the card, 10px mono, the faintest
          gray, wrapped again inside a 42em box — while the most important line on
          the whole page was buried in there: *"No live sync / file watcher — two
          manual actions."* That's the product actively saying what it doesn't do,
          and it's the owner's only basis for deciding whether to wait for auto-sync
          — it shouldn't be the smallest text on the page (the second half of
          UX-63). The neighboring /admin/sources page describes the same kind of
          thing with serif body text (`reading text-[14.5px]`) — two sibling pages
          talking about the same kind of thing should sound alike. This copies that
          page's approach rather than inventing a new one. */}
      <p className="reading text-[14.5px] text-(--color-muted) mb-2 max-w-[54em]"
        data-testid="obsidian-intro">
        {t('help')}
      </p>
      {/* "No live sync" gets its own line, in ink color: it's the sentence most
          worth reading on this page, not a tail-end of the explanation. */}
      <p className="reading text-[14.5px] text-(--color-ink) mb-6 max-w-[54em]"
        data-testid="obsidian-no-sync">
        {t('noSync')}
      </p>
      <div className="border border-(--color-rule) rounded-[3px] p-4 bg-(--color-surface)/50 max-w-[640px]">
        <div className="sm-smallcaps mb-3">{t('importExport')}</div>
        <ObsidianBar onImported={() => setReloadKey((k) => k + 1)} />
        {/* UX-62: **did this thing ever happen**. This screen used to have no past
            tense at all — an instance carrying 1028 notes looked identical to an
            empty one, and the count from an import vanished the moment the refresh
            happened. Copy follows the /admin/sources family
            (`never fetched` / `last · <date>`), not a new invention. */}
        <p className="mono text-[10.5px] tracking-[0.12em] uppercase text-(--color-muted) mt-3"
          data-testid="obsidian-last-import">
          {vaultImportLine(importState)}
        </p>
      </div>
    </>
  );
}
