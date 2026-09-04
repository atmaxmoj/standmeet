// AuthoringPanel — write a custom page in the panel: edit source → build preview →
// watch it render inline → publish.
//
// This block did not exist before. The capability to write this set **always existed**
// (create / write_file / build / get_build / promote_to_live all present), just on MCP
// only, and the exception's reason was "the panel has no UI for this" — explaining the
// status quo with the status quo. After removing the exception, the closure named these
// items; this is their face.
//
// Four things are deliberate:
//   · Build is **async**, so "running" / "succeeded" / "failed" must be visually
//     distinguishable — a silently failed build, with the live page still the old one,
//     looks identical to success from the owner's view.
//   · On failure, show **the backend's exact message** verbatim, not just "build failed".
//   · **Build preview is separate from publish**: the owner's words — "writing here, I
//     can't see the effect at all." Build preview stages the build and renders it inline
//     WITHOUT going live, so the owner sees it before shipping; publish goes live.
//   · Publish is a separate step: a successful build does not mean the owner wants it live.

'use client';

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';

import {
  IMPORTABLE_MODULES, STARTER, type ImportableModule,
} from '@/lib/admin/custom-page-imports';
import {
  shipLive, stagePage, previewView, usePinnedPreviewSrc,
  type BuildView, type CustomPageSummary, type CustomPagesHook,
} from '@/lib/admin/use-custom-pages';
import { useAction } from '@/lib/ui/use-action';
import { CodeEditor } from '@/components/admin/sections/custom-pages/CodeEditor';

// AuthoringPanel — the split editor for the SELECTED page: source on the left, its live render on
// the right (owner: "点进去左边编辑右边渲染"). slug is controlled by the list selection above; an
// empty slug is the "new page" case, where the slug field is editable.
export function AuthoringPanel(
  { hook, slug, onSlugChange }: { hook: CustomPagesHook; slug: string; onSlugChange: (v: string) => void },
) {
  const t = useTranslations('adminPages.customPages');
  const run = useAction();
  const [source, setSource] = useState(STARTER);
  const [build, setBuild] = useState<BuildView | null>(null);
  // The staging build's signed preview_url lives on the list row (the store the panel shares with
  // the list), so the right-hand render follows the same long-poll and swaps on a new build.
  const staged = hook.rows.find((r) => r.slug === slug.trim());

  const preview = useCallback(() => {
    setBuild(null);
    void run(() => stagePage(slug.trim(), source, setBuild), { success: t('staged') });
  }, [run, slug, source, t]);

  const publish = useCallback(() => {
    void run(() => shipLive(slug.trim(), source, build, setBuild), { success: t('published') });
  }, [run, slug, source, build, t]);

  return (
    <section className="mt-6" data-testid="custom-page-editor">
      <div className="grid gap-4 lg:grid-cols-2 items-start">
        <div className="border border-(--color-rule) rounded-[3px] p-4">
          <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-2">
            {t('authorHeading')}
          </div>
          <ImportsHelp />
          <SlugField value={slug} onChange={onSlugChange} />
          <SourceField value={source} onChange={setSource} />
          <div className="flex items-center gap-3 mt-3">
            <button
              type="button" onClick={preview} disabled={slug.trim() === ''}
              data-testid="custom-page-build"
              className="sm-btn sm-btn-sm disabled:opacity-40"
            >
              {t('buildPreview')}
            </button>
            <button
              type="button" onClick={publish} disabled={slug.trim() === ''}
              data-testid="custom-page-publish"
              className="sm-btn sm-btn-solid sm-btn-sm disabled:opacity-40"
            >
              {t('publish')}
            </button>
            <BuildLine build={build} />
          </div>
        </div>
        <div className="lg:sticky lg:top-4">
          {staged === undefined ? <PreviewEmpty /> : <StagingPreview page={staged} />}
        </div>
      </div>
    </section>
  );
}

// PreviewEmpty — the right pane before a build exists for this slug (a new page, or one never
// built): say so rather than leave a blank void the owner reads as "broken".
function PreviewEmpty() {
  const t = useTranslations('adminPages.customPages');
  return (
    <div
      data-testid="custom-page-preview-empty"
      className="border border-dashed border-(--color-rule) rounded-[3px] h-[420px] grid place-items-center mono text-[11px] text-(--color-faint)"
    >
      {t('previewEmpty')}
    </div>
  );
}

// StagingPreview — what the build you just staged looks like, **inline, before it goes
// live**. Distinct testids from the list's PagePreview so the same slug rendered in both
// places never collides. Reuses previewView + usePinnedPreviewSrc so it follows builds
// the same way the list does (token churn doesn't reload; a new build id swaps the frame).
function StagingPreview({ page }: { page: CustomPageSummary }) {
  const t = useTranslations('adminPages.customPages');
  const view = previewView(page);
  const src = usePinnedPreviewSrc(view.buildID, view.src);
  return src === '' ? null : (
    <div className="mt-4 border border-(--color-rule) rounded-sm overflow-hidden" data-testid="custom-page-staging">
      <div className="flex items-baseline justify-between px-3 py-1.5 border-b border-(--color-rule)/60">
        <span className="mono text-[9.5px] tracking-[0.14em] uppercase text-(--color-faint)">
          {t('stagingLabel')}
        </span>
        <span
          data-testid="custom-page-staging-state"
          className="mono text-[9.5px] tracking-[0.14em] uppercase text-(--color-muted)"
        >
          {view.status}
        </span>
      </div>
      <iframe
        key={view.buildID}
        data-testid="custom-page-staging-frame"
        src={src}
        title="staging preview"
        sandbox="allow-scripts"
        className="w-full h-[420px] border-0 bg-(--color-paper)"
      />
    </div>
  );
}

// ImportsHelp — what can be imported. **This is the thing this panel was missing**: the
// builder has long vendored sdk / sdk-core / agent-core, but nothing on screen said so,
// so the owner had to guess. The list comes from `custom-page-imports.ts`, which a gate
// pins to stay consistent with builder/vendor.
function ImportsHelp() {
  const t = useTranslations('adminPages.customPages');
  return (
    <details className="mb-3" data-testid="custom-page-imports">
      <summary className="mono text-[10px] tracking-[0.14em] uppercase text-(--color-accent) cursor-pointer">
        {t('importsSummary')}
      </summary>
      <ul className="mt-2 space-y-2">
        {IMPORTABLE_MODULES.map((m) => <ImportRow key={m.module} entry={m} />)}
      </ul>
    </details>
  );
}

function ImportRow({ entry }: { entry: ImportableModule }) {
  return (
    <li className="reading text-[12px] text-(--color-muted)">
      <code className="mono text-[11.5px] text-(--color-ink)">{entry.module}</code>
      <span className="mono text-[11px]"> {entry.exports.join(' · ')}</span>
      <div className="text-[11.5px]">{entry.note}</div>
    </li>
  );
}

function SlugField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const t = useTranslations('adminPages.customPages');
  return (
    <label className="block mb-3">
      <span className="mono text-[9.5px] tracking-[0.14em] uppercase text-(--color-faint) block mb-1">
        {t('slugLabel')}
      </span>
      <input
        type="text" value={value} placeholder="press-kit"
        data-testid="custom-page-slug"
        onChange={(e) => onChange(e.target.value)}
        className="sm-field-input sm-mono"
      />
    </label>
  );
}

function SourceField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const t = useTranslations('adminPages.customPages');
  return (
    <label className="block">
      <span className="mono text-[9.5px] tracking-[0.14em] uppercase text-(--color-faint) block mb-1">
        {t('sourceLabel')}
      </span>
      <CodeEditor value={value} onChange={onChange} testId="custom-page-source" />
    </label>
  );
}

// BuildLine — the three states "running / succeeded / failed" must be distinguishable,
// and the failed state must show the backend's exact message: the owner needs to fix a
// line in the source, not read "build failed".
function BuildLine({ build }: { build: BuildView | null }) {
  return build === null ? null : <BuildState build={build} />;
}

function BuildState({ build }: { build: BuildView }) {
  return build.status === 'failed'
    ? <BuildFailed message={build.error_message ?? ''} />
    : <BuildProgress built={build.status === 'built'} />;
}

// BuildFailed — **show the backend's exact message verbatim**. The owner needs to fix a
// line in the source; "build failed" alone is useless to him.
function BuildFailed({ message }: { message: string }) {
  const t = useTranslations('adminPages.customPages');
  return (
    <span data-testid="custom-page-build-failed" className="mono text-[11px] text-(--color-accent)">
      {t('buildFailed')} · {message}
    </span>
  );
}

function BuildProgress({ built }: { built: boolean }) {
  const t = useTranslations('adminPages.customPages');
  return (
    <span data-testid="custom-page-build-status" className="mono text-[11px] text-(--color-muted)">
      {built ? t('buildBuilt') : t('buildRunning')}
    </span>
  );
}
