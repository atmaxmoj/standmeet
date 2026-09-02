// AuthoringPanel — write a custom page in the panel: paste source → build → watch status
// → publish.
//
// This block did not exist before. The capability to write this set **always existed**
// (create / write_file / build / get_build / promote_to_live all present), just on MCP
// only, and the exception's reason was "the panel has no UI for this" — explaining the
// status quo with the status quo. After removing the exception, the closure named these
// items; this is their face.
//
// Three things are deliberate:
//   · Build is **async**, so "running" / "succeeded" / "failed" must be visually
//     distinguishable — a silently failed build, with the live page still the old one,
//     looks identical to success from the owner's view.
//   · On failure, show **the backend's exact message** verbatim, not just "build failed".
//   · Publish is a separate step: a successful build does not mean the owner wants it live.

'use client';

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';

import {
  IMPORTABLE_MODULES, STARTER, type ImportableModule,
} from '@/lib/admin/custom-page-imports';
import { publishPage, type BuildView } from '@/lib/admin/use-custom-pages';
import { useAction } from '@/lib/ui/use-action';

export function AuthoringPanel() {
  const t = useTranslations('adminPages.customPages');
  const run = useAction();
  const [slug, setSlug] = useState('');
  const [source, setSource] = useState(STARTER);
  const [build, setBuild] = useState<BuildView | null>(null);

  const publish = useCallback(() => {
    setBuild(null);
    void run(() => publishPage(slug, source, setBuild), { success: t('published') });
  }, [run, slug, source, t]);

  return (
    <section className="mt-6 border border-(--color-rule) rounded-[3px] p-4">
      <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-2">
        {t('authorHeading')}
      </div>
      <p className="reading text-[12.5px] text-(--color-muted) mb-3">{t('authorHelp')}</p>
      <ImportsHelp />
      <SlugField value={slug} onChange={setSlug} />
      <SourceField value={source} onChange={setSource} />
      <div className="flex items-center gap-3 mt-3">
        <button
          type="button" onClick={publish} disabled={slug === ''}
          data-testid="custom-page-publish"
          className="sm-btn sm-btn-solid sm-btn-sm disabled:opacity-40"
        >
          {t('publish')}
        </button>
        <BuildLine build={build} />
      </div>
    </section>
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
      <textarea
        value={value} rows={14}
        data-testid="custom-page-source"
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-transparent border border-(--color-rule) focus:border-(--color-ink) rounded-sm p-2 mono text-[12px]"
      />
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
