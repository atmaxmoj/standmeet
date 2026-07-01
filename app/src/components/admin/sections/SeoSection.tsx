// SeoSection —— /admin/seo，接真后端（#102）。
//
// site_title 是 owner 自写、可编辑并持久化的字段；og:description 与 canonical
// host 是**只读镜像**——分别复用 page.tagline / owner.public_url，在各自的 section
// 编辑（这里只展示 + 跳转链接，避免同一个值两处可改）。robots 是真开关，
// indexing stats 是真计数 + owner 可选统计范围（默认全含）。
//
// 已删：regenerate-sitemap 按钮（sitemap 实时算，无「待重算」）、twitter handle
// （死字段）。

'use client';

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
      <SectionHeader kicker="settings · search" title="seo" />
      <Intro />
      {seo.settings
        ? <SeoBody settings={seo.settings} stats={seo.stats} save={seo.save} />
        : <LoadingNote />}
    </>
  );
}

function Intro() {
  return (
    <p className="reading text-[14.5px] text-(--color-muted) mb-6 max-w-[54em]">
      Defaults applied across the public site. Per-output / per-post SEO lives with the individual
      entry. Site title is edited here; the social description and canonical host mirror your page
      tagline and domain — edit those where they live.
    </p>
  );
}

function LoadingNote() {
  return <p className="mono text-[12px] text-(--color-faint)">loading…</p>;
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
  return (
    <div className="border border-(--color-rule) rounded-[3px] p-4 bg-(--color-surface)/50 flex flex-col gap-4">
      <div className="sm-smallcaps">defaults</div>
      <LabeledInput label="site title" testid="seo-site-title" value={form.site_title}
        onChange={(v) => setForm({ ...form, site_title: v })} placeholder="Your public site title" />
      <LabeledInput label="og template" testid="seo-og-template" value={form.og_template}
        onChange={(v) => setForm({ ...form, og_template: v })} placeholder="og:image template (optional)" />
      <RobotsToggle on={form.index_robots}
        onToggle={() => setForm({ ...form, index_robots: !form.index_robots })} />
      <DescriptionMirror />
      <CanonicalMirror />
      <div>
        <button type="button" data-testid="seo-save" className="sm-btn sm-btn-primary sm-btn-sm"
          onClick={onSave}>save</button>
      </div>
    </div>
  );
}

function LabeledInput({ label, testid, value, onChange, placeholder }: {
  label: string; testid: string; value: string;
  onChange: (v: string) => void; placeholder: string;
}) {
  return (
    <label className="block">
      <div className="sm-smallcaps mb-1">{label}</div>
      <input type="text" data-testid={testid} value={value} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-(--color-rule) rounded-[3px] px-3 py-2 text-(--color-ink) text-[14px] bg-(--color-surface)" />
    </label>
  );
}

function RobotsToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button type="button" data-testid="seo-robots" onClick={onToggle}
      className="flex items-center gap-2 text-[13px] text-(--color-ink)">
      <span className="mono text-[11px]">{on ? '[x]' : '[ ]'}</span>
      <span>index, follow (robots)</span>
    </button>
  );
}

// DescriptionMirror —— og:description 复用 page.tagline，只读 + 跳 /admin/page 编辑。
function DescriptionMirror() {
  return (
    <div data-testid="seo-description">
      <div className="sm-smallcaps mb-1">og:description</div>
      <p className="reading text-[13px] text-(--color-muted)">
        Uses your page tagline.{' '}
        <a data-testid="seo-description-edit" href="/admin/page"
          className="text-(--color-accent) underline">edit on the Page section →</a>
      </p>
    </div>
  );
}

// CanonicalMirror —— canonical host = owner.public_url，只读 + 跳 /admin/domain 编辑。
function CanonicalMirror() {
  const session = useAdminSession();
  const host = session.kind === 'ready' ? session.session.public_url : '';
  return (
    <div data-testid="seo-canonical">
      <div className="sm-smallcaps mb-1">canonical host</div>
      <p className="mono text-[12px] text-(--color-muted)">
        {host || '—'}{' '}
        <a data-testid="seo-canonical-edit" href="/admin/domain"
          className="text-(--color-accent) underline">edit on the Domain section →</a>
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

// IndexingCard —— 真计数 + owner 选统计范围（默认三 tier 全含），总数按 scope 求和。
function IndexingCard({ stats }: { stats: SEOStats | null }) {
  const [scope, setScope] = useState<Record<string, boolean>>(
    { wiki: true, outputs: true, writings: true },
  );
  const toggle = (k: string) => setScope({ ...scope, [k]: !scope[k] });
  const rows = TIERS.map((t) => tierRow(t, scope, stats));
  const total = rows.filter((r) => r.on).reduce((n, r) => n + r.value, 0);
  return (
    <div className="border border-(--color-rule) rounded-[3px] p-4 bg-(--color-surface)/50"
      data-testid="seo-indexing">
      <div className="sm-smallcaps mb-3">indexing · published</div>
      <div className="grid grid-cols-3 gap-3">
        {rows.map((r) => <IndexStat key={r.key} row={r} onToggle={() => toggle(r.key)} />)}
      </div>
      <div className="mono text-[11px] text-(--color-muted) mt-3" data-testid="seo-stat-total">
        total in scope: {total}
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
