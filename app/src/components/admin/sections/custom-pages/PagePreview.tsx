// PagePreview — what this page looks like right now.
//
// **Why this block exists**: this panel used to be just a table — slug, which codes are
// bound, whether it's live. Not a word about what the page looks like. And the one
// actually writing these pages is Claude (the panel's own intro says "creates / builds /
// promotes via MCP"), so the owner sat in the worst spot: he gives the instructions,
// and the only feedback is a single line "has_live: true". The owner's own words:
// "let me have a panel to see the effect, and let me see it live while I'm directing
// the agent to make changes."
//
// It shows the version from **the most recent successful build**, not live — the build
// the agent just finished and hasn't promoted yet is what he wants to see (he decides
// whether to publish after looking). Backend route: `/api/admin/custom-pages/{slug}/preview`.
//
// **Refresh goes through the key, not reload()**: the build id is baked into the key, so
// when a new build lands React swaps the whole iframe. Calling contentWindow.location.
// reload() manually needs the iframe's DOM handle, which fails silently across origins
// or before load finishes — swapping the key "rebuilds a new element" instead, with no
// failure branch.

'use client';

import { useTranslations } from 'next-intl';

import {
  previewView, usePinnedPreviewSrc, type CustomPageSummary,
} from '@/lib/admin/use-custom-pages';

export function PagePreview({ page }: { page: CustomPageSummary }) {
  const t = useTranslations('adminPages.customPages');
  // The URL is issued by the **backend** (token signed into it). The frontend only
  // decides when to swap in a new one.
  const view = previewView(page);
  return (
    <div className="border-t border-(--color-rule)/60">
      <div className="flex items-baseline justify-between px-4 py-2">
        <span className="mono text-[9.5px] tracking-[0.14em] uppercase text-(--color-faint)">
          {t('previewLabel')}
        </span>
        <BuildState status={view.status} />
      </div>
      <PreviewFrame slug={page.slug} buildID={view.buildID} src={view.src} />
    </div>
  );
}

// BuildState — while the agent is building, the owner needs to see "it's moving".
// Without this line, the screen sits completely still for tens of seconds during a
// build, indistinguishable from "my instruction never arrived".
function BuildState({ status }: { status: string }) {
  const t = useTranslations('adminPages.customPages');
  return (
    <span
      data-testid="custom-page-build-state"
      className="mono text-[9.5px] tracking-[0.14em] uppercase text-(--color-muted)"
    >
      {status === '' ? t('buildNone') : status}
    </span>
  );
}

function PreviewFrame(
  { slug, buildID, src }: { slug: string; buildID: string; src: string },
) {
  const t = useTranslations('adminPages.customPages');
  // src is pinned to buildID: the token churning every 3s should not reload the iframe
  // (logic lives in usePinnedPreviewSrc).
  const shownSrc = usePinnedPreviewSrc(buildID, src);
  return shownSrc === '' ? (
    <div
      data-testid={`custom-page-preview-empty-${slug}`}
      className="sm-empty mono text-[11px] text-(--color-faint) px-4 pb-4"
    >
      {t('previewNoBuild')}
    </div>
  ) : (
    <iframe
      // key carries the build id: when a new build lands, React swaps in a fresh iframe
      // instead of letting the old one reload itself.
      key={buildID}
      data-testid={`custom-page-preview-${slug}`}
      src={shownSrc}
      title={slug}
      // Sandbox: this is the owner's own code, but it runs on admin's origin —
      // without allow-same-origin, the page can't touch the owner's session
      // (same reasoning as resolveDefaults in widget-descriptor.ts).
      sandbox="allow-scripts"
      className="w-full h-[420px] border-0 bg-(--color-paper)"
    />
  );
}
