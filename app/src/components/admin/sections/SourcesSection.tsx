// SourcesSection —— /admin/sources. The feed sources the job loop pulls from, plus a
// form to register one and a button to remove one.
//
// **F-E-1, in the world where it works**: the "+ board" header buttons were once removed
// because they were dead (no onClick) — registering was MCP-only, so an admin button
// would have been lying. Now the backend has POST/DELETE /job-sources, so the affordance
// comes back, wired: pick a kind, give it a label + config, register. Same shape as
// custom-pages F-N-1 ("the button must not exist" → "the button must exist and work").
//
// The header count said "N active" — but job_sources has no active/inactive column; it
// was just the row count wearing a status word it doesn't have ([[names-that-lie]]). Now
// it says "N registered".

'use client';

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';

import { SectionHeader } from '@/components/admin/SectionHeader';
import { SelectField } from '@/components/atoms/SelectField';
import { ListSkeleton } from '@/components/skeletons/ListSkeleton';
import { sourceFailed, sourceStateLine } from '@/lib/admin/source-state';
import {
  ADAPTER_KINDS, useAdminSources, pickSourcesBodyState,
  type AdminSourceRow, type AdminSourcesHook,
} from '@/lib/admin/use-admin-sources';
import { useAction } from '@/lib/ui/use-action';

export function SourcesSection() {
  const hook = useAdminSources();
  return (
    <>
      <SectionHeader
        kicker="jobs · sources"
        slug="sources"
        count={hook.loading ? '' : `${hook.rows.length} registered`}
      />
      <Intro />
      <Body hook={hook} />
      <RegisterForm hook={hook} />
    </>
  );
}

function Body({ hook }: { hook: AdminSourcesHook }) {
  const map = {
    loading: <ListSkeleton count={3} />,
    error: <ErrorBlock message={hook.error ?? ''} />,
    empty: <EmptyState />,
    list: <SourceTable hook={hook} />,
  } as const;
  return map[pickSourcesBodyState(hook.rows.length, hook.loading, hook.error)];
}

function ErrorBlock({ message }: { message: string }) {
  return (
    <p className="mono text-[11px] text-(--color-accent) mt-8" data-testid="sources-error">
      {message}
    </p>
  );
}

function SourceTable({ hook }: { hook: AdminSourcesHook }) {
  return (
    <ul className="flex flex-col gap-2" data-testid="sources-list">
      {hook.rows.map((s) => <SourceRow key={s.id} source={s} hook={hook} />)}
    </ul>
  );
}

function SourceRow({ source, hook }: { source: AdminSourceRow; hook: AdminSourcesHook }) {
  return (
    <li
      className="flex items-baseline justify-between gap-3 border border-(--color-rule) rounded-[3px] px-4 py-3"
      data-testid={`source-row-${source.id}`}
    >
      <span className="min-w-0">
        <span className="reading text-(--color-ink) text-[15px]">{source.label}</span>
        <span className="mono text-[10.5px] tracking-[0.12em] uppercase text-(--color-muted) ml-3">
          {source.kind}
        </span>
      </span>
      <span className="flex items-baseline gap-3 shrink-0">
        <SourceState source={source} />
        <RemoveButton source={source} hook={hook} />
      </span>
    </li>
  );
}

// SourceState —— never tried / last try failed (with reason) / last try succeeded (F-E-18).
function SourceState({ source }: { source: AdminSourceRow }) {
  const tone = sourceFailed(source) ? 'text-(--color-accent)' : 'text-(--color-faint)';
  return (
    <span
      className={`mono text-[10.5px] text-right max-w-[40vw] ${tone}`}
      data-testid={`source-state-${source.id}`}
    >
      {sourceStateLine(source)}
    </span>
  );
}

function RemoveButton({ source, hook }: { source: AdminSourceRow; hook: AdminSourcesHook }) {
  const t = useTranslations('adminJobs');
  const run = useAction();
  return (
    <button
      type="button"
      data-testid={`source-remove-${source.id}`}
      className="mono text-[10px] tracking-[0.14em] uppercase text-(--color-muted) hover:text-(--color-accent)"
      onClick={() => void run(() => hook.removeSource(source.id), { success: t('sources.removed') })}
    >
      {t('sources.remove')}
    </button>
  );
}

// RegisterForm —— pick a kind, label it, give it config, register. The kind picker
// prefills the config example; the backend is the one validator, so a bad config comes
// back as a 400 the toast shows verbatim.
function RegisterForm({ hook }: { hook: AdminSourcesHook }) {
  const t = useTranslations('adminJobs');
  const run = useAction();
  const [kind, setKind] = useState(ADAPTER_KINDS[0]!.kind);
  const [label, setLabel] = useState('');
  const [config, setConfig] = useState(ADAPTER_KINDS[0]!.config);
  const onKind = useCallback((k: string) => {
    setKind(k);
    setConfig(ADAPTER_KINDS.find((a) => a.kind === k)?.config ?? '');
  }, []);
  const register = useCallback(() => {
    void run(() => hook.registerSource(kind, label.trim(), config), { success: t('sources.registered') });
  }, [run, hook, kind, label, config, t]);
  return (
    <section className="mt-6 border border-(--color-rule) rounded-[3px] p-4" data-testid="source-register">
      <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-3">
        {t('sources.formHeading')}
      </div>
      <div className="flex flex-col gap-3 max-w-[42em]">
        <KindPicker value={kind} onChange={onKind} label={t('sources.kindLabel')} />
        <Field label={t('sources.labelLabel')}>
          <input
            type="text" value={label} placeholder="Listings Board"
            data-testid="source-label" onChange={(e) => setLabel(e.target.value)}
            className="sm-field-input sm-mono"
          />
        </Field>
        <Field label={t('sources.configLabel')}>
          <input
            type="text" value={config} placeholder="{}"
            data-testid="source-config" onChange={(e) => setConfig(e.target.value)}
            className="sm-field-input sm-mono"
          />
        </Field>
        <button
          type="button" onClick={register} disabled={label.trim() === ''}
          data-testid="source-register-submit"
          className="sm-btn sm-btn-solid sm-btn-sm self-start disabled:opacity-40"
        >
          {t('sources.register')}
        </button>
      </div>
    </section>
  );
}

function KindPicker({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <Field label={label}>
      <SelectField value={value} testid="source-kind" mono onChange={(e) => onChange(e.target.value)}>
        {ADAPTER_KINDS.map((a) => <option key={a.kind} value={a.kind}>{a.kind}</option>)}
      </SelectField>
    </Field>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mono text-[9.5px] tracking-[0.14em] uppercase text-(--color-faint) block mb-1">
        {label}
      </span>
      {children}
    </label>
  );
}

// mono —— the <mono> tag for t.rich: renders MCP tool names as monospace ink.
const mono = (chunks: React.ReactNode) => (
  <span className="mono text-(--color-ink)">{chunks}</span>
);

function Intro() {
  const t = useTranslations('adminJobs');
  return (
    <p className="reading text-[14.5px] text-(--color-muted) mb-6 max-w-[54em]" data-testid="sources-intro">
      {t.rich('sources.intro', { mono })}
    </p>
  );
}

function EmptyState() {
  const t = useTranslations('adminJobs');
  return (
    <div className="sm-empty">
      <div className="sm-smallcaps mb-1.5">{t('sources.emptyKicker')}</div>
      <div className="sm-empty-title">{t('sources.emptyTitle')}</div>
      <p className="sm-empty-hint reading">
        {t.rich('sources.emptyHint', { mono })}
      </p>
    </div>
  );
}
