// ObsidianSection —— /admin/obsidian. The real, working import/export lives in the shared
// ObsidianBar (a vault-folder picker → POST /obsidian/import, and export → GET /obsidian/export) —
// the same component the writings section uses. This page used to be a dead mockup (a fake vault
// path + hardcoded stats + two buttons with no onClick); it now renders the real actions (F-L-1).
// No live sync / file watcher by design — two manual actions.

'use client';

import { SectionHeader } from '@/components/admin/SectionHeader';
import { ObsidianBar } from '@/components/admin/sections/writings/ObsidianBar';

export function ObsidianSection() {
  return (
    <>
      <SectionHeader
        kicker="integrations · vault"
        title="obsidian"
        action={
          <span className="mono text-[10.5px] tracking-[0.16em] uppercase text-(--color-faint)">
            ○ manual mode
          </span>
        }
      />
      <div className="border border-(--color-rule) rounded-[3px] p-4 bg-(--color-surface)/50 max-w-[640px]">
        <div className="sm-smallcaps mb-3">import / export</div>
        <ObsidianBar onImported={() => { /* no corpus list to refresh on this page */ }} />
        <p className="mono text-[10px] text-(--color-faint) tracking-[0.06em] mt-1 max-w-[42em]">
          import picks your Obsidian vault folder (wiki / subjectivity / raw / writings) and upserts
          the matching corpus notes by their vault path. export downloads your corpus as a vault of
          markdown + frontmatter. No live sync / file watcher — two manual actions.
        </p>
      </div>
    </>
  );
}
