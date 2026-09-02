// SeoSection —— /admin/seo, wired to the real backend (#102).
//
// site_title is an owner-authored field, editable and persisted; og:description and canonical
// host are **read-only mirrors** — they reuse page's **hero prose** (`hero_prose`) / owner.public_url
// respectively, and are edited in their own section (here they're just shown + a jump link,
// to avoid the same value being editable in two places).
//
// This copy used to say "your page tagline", but nothing in the product is called a tagline:
// the field's label in the hero section is `prose`, and the backend field is `hero_prose`. An
// owner following that copy into /admin/page wouldn't find what it described. robots is a real
// toggle, and indexing stats are real counts + an owner-selectable scope (all tiers included by default).
//
// Removed: the regenerate-sitemap button (the sitemap is computed live, there's no "pending
// regeneration" state), and twitter handle (a dead field).

'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { SectionHeader } from '@/components/admin/SectionHeader';
import { useAdminSession } from '@/lib/admin/use-admin-session';
import { useSEO, type SEOSettings, type SEOStats } from '@/lib/admin/use-seo';
import { useAction } from '@/lib/ui/use-action';
import { useEffectErrorToast } from '@/lib/ui/toast';

export function SeoSection() {
  const seo = useSEO();
  useEffectErrorToast(seo.error);
  return (
    <>
      <SectionHeader kicker="settings · search" slug="seo" />
      <Intro />
      {seo.settings
        ? <SeoBody settings={seo.settings} stats={seo.stats} save={seo.save} />
        : <LoadingNote />}
    </>
  );
}

function Intro() {
  const t = useTranslations('adminCorpus.seo');
  return (
    <p className="reading text-[14.5px] text-(--color-muted) mb-6 max-w-[54em]">
      {t('intro')}
    </p>
  );
}

function LoadingNote() {
  const t = useTranslations('adminCorpus.common');
  return <p className="mono text-[12px] text-(--color-faint)">{t('loading')}</p>;
}

function SeoBody({ settings, stats, save }: {
  settings: SEOSettings; stats: SEOStats | null; save: (s: SEOSettings) => Promise<void>;
}) {
  const run = useAction();
  const [form, setForm] = useState<SEOSettings>(settings);
  const onSave = () => void run(() => save(form), { success: 'SEO settings saved' });
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1.3fr_1fr] gap-6">
      <DefaultsCard form={form} setForm={setForm} onSave={onSave} />
      <IndexingCard stats={stats} />
    </div>
  );
}

function DefaultsCard({ form, setForm, onSave }: {
  form: SEOSettings; setForm: (s: SEOSettings) => void; onSave: () => void;
}) {
  const t = useTranslations('adminCorpus');
  return (
    <div className="border border-(--color-rule) rounded-[3px] p-4 bg-(--color-surface)/50 flex flex-col gap-4">
      <div className="sm-smallcaps">{t('seo.defaults')}</div>
      {/* This card only **owns** these two fields, and they used to have zero explanation —
          while the two read-only mirrors next to it each got a sentence plus a jump link
          (UX-57: the care went the wrong direction). What an empty value does and what counts
          as a good value need to be said here. */}
      <LabeledInput label="site title" testid="seo-site-title" value={form.site_title}
        onChange={(v) => setForm({ ...form, site_title: v })} placeholder="Your public site title"
        hint={t('seo.siteTitleHint')} />
      <LabeledInput label="og template" testid="seo-og-template" value={form.og_template}
        onChange={(v) => setForm({ ...form, og_template: v })} placeholder="og:image template (optional)"
        hint={t('seo.ogTemplateHint')} />
      <RobotsToggle on={form.index_robots}
        onToggle={() => setForm({ ...form, index_robots: !form.index_robots })} />
      <DescriptionMirror />
      <CanonicalMirror />
      <div>
        <button type="button" data-testid="seo-save" className="sm-btn sm-btn-solid sm-btn-sm"
          onClick={onSave}>{t('common.save')}</button>
      </div>
    </div>
  );
}

function LabeledInput({ label, testid, value, onChange, placeholder, hint }: {
  label: string; testid: string; value: string;
  onChange: (v: string) => void; placeholder: string; hint: string;
}) {
  return (
    <label className="block">
      <div className="sm-smallcaps mb-1">{label}</div>
      <input type="text" data-testid={testid} value={value} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="sm-field-input" />
      {/* Don't use `reading` — that class comes with 20px, which would make the hint text
          bigger than the field it's explaining. A hint is secondary text; its font size must
          actually be smaller than body text. */}
      <p className="font-serif text-[13px] leading-[1.5] text-(--color-faint) mt-1.5 max-w-[46em]">{hint}</p>
    </label>
  );
}

function RobotsToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  const t = useTranslations('adminCorpus.seo');
  return (
    <button type="button" data-testid="seo-robots" onClick={onToggle}
      className="flex items-center gap-2 text-[13px] text-(--color-ink)">
      <span className="mono text-[11px]">{on ? '[x]' : '[ ]'}</span>
      <span>{t('robots')}</span>
    </button>
  );
}

// MirrorEditLink —— the "this value is edited elsewhere" link, **defined in one place only**.
//
// Previously the og:description one was large serif (following the hint paragraph's typography),
// while the canonical host one was small mono (following the hostname's typography) — same
// destination, same meaning, but rendered as two different things (UX-74①). The cause was each
// one inheriting its parent paragraph's font instead of declaring its own. This pins it to a
// single form, independent of whatever font the surrounding body text uses.
function MirrorEditLink({ testid }: { testid: string }) {
  const t = useTranslations('adminCorpus.seo');
  return (
    <a data-testid={testid} href="/admin/page"
      className="mono text-[11px] tracking-[0.04em] text-(--color-accent) underline whitespace-nowrap">
      {t('editOnPage')}
    </a>
  );
}

// DescriptionMirror —— og:description reuses page's hero prose, read-only + jumps to /admin/page to edit.
function DescriptionMirror() {
  const t = useTranslations('adminCorpus.seo');
  return (
    <div data-testid="seo-description">
      <div className="sm-smallcaps mb-1">{t('ogDescription')}</div>
      <p className="reading text-[13px] text-(--color-muted)">
        {t('usesHeroProse')}{' '}
        <MirrorEditLink testid="seo-description-edit" />
      </p>
    </div>
  );
}

// CanonicalMirror —— canonical host = owner.public_url, read-only + jumps to /admin/domain to edit.
function CanonicalMirror() {
  const t = useTranslations('adminCorpus.seo');
  const session = useAdminSession();
  const host = session.kind === 'ready' ? session.session.public_url : '';
  return (
    <div data-testid="seo-canonical">
      <div className="sm-smallcaps mb-1">{t('canonicalHost')}</div>
      <p className="mono text-[12px] text-(--color-muted)">
        {host || '—'}{' '}
        <MirrorEditLink testid="seo-canonical-edit" />
      </p>
    </div>
  );
}

const TIERS = [
  { key: 'wiki' as const, label: 'pages' },
  { key: 'outputs' as const, label: 'outputs' },
  { key: 'writings' as const, label: 'writings' },
];

interface TierRow { key: string; label: string; on: boolean; value: number }

function statOf(stats: SEOStats | null, key: keyof SEOStats): number {
  return stats ? stats[key] : 0;
}

function tierRow(
  t: { key: keyof SEOStats; label: string }, scope: Record<string, boolean>, stats: SEOStats | null,
): TierRow {
  return { key: t.key, label: t.label, on: scope[t.key] ?? false, value: statOf(stats, t.key) };
}

// IndexingCard —— real counts + an owner-selectable stat scope (all three tiers included by
// default), total is summed according to scope.
function IndexingCard({ stats }: { stats: SEOStats | null }) {
  const t = useTranslations('adminCorpus.seo');
  const [scope, setScope] = useState<Record<string, boolean>>(
    { wiki: true, outputs: true, writings: true },
  );
  const toggle = (k: string) => setScope({ ...scope, [k]: !scope[k] });
  const rows = TIERS.map((t) => tierRow(t, scope, stats));
  const total = rows.filter((r) => r.on).reduce((n, r) => n + r.value, 0);
  return (
    <div className="border border-(--color-rule) rounded-[3px] p-4 bg-(--color-surface)/50"
      data-testid="seo-indexing">
      <div className="sm-smallcaps mb-3">{t('indexing')}</div>
      <div className="grid grid-cols-3 gap-3">
        {rows.map((r) => <IndexStat key={r.key} row={r} onToggle={() => toggle(r.key)} />)}
      </div>
      <div className="mono text-[11px] text-(--color-muted) mt-3" data-testid="seo-stat-total">
        {t('totalInScope', { total })}
      </div>
    </div>
  );
}

function IndexStat({ row, onToggle }: { row: TierRow; onToggle: () => void }) {
  return (
    <button type="button" data-testid={`seo-stat-${row.key}`} onClick={onToggle} data-scope={row.on ? '1' : '0'}
      className={`border border-(--color-rule) rounded-[3px] p-3 bg-(--color-surface)/30 text-left ${row.on ? '' : 'opacity-40'}`}>
      <div className="sm-smallcaps mb-1">{row.label}</div>
      <div className="font-serif text-(--color-ink) text-[28px] tabular-nums leading-none">{row.value}</div>
    </button>
  );
}
