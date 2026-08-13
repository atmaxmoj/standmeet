// SeoSection —— /admin/seo，接真后端（#102）。
//
// site_title 是 owner 自写、可编辑并持久化的字段；og:description 与 canonical
// host 是**只读镜像**——分别复用 page 的 **hero prose**(`hero_prose`) / owner.public_url，
// 在各自的 section 编辑（这里只展示 + 跳转链接，避免同一个值两处可改）。
//
// 这块的文案以前写的是 "your page tagline"，而产品里没有任何叫 tagline 的东西：hero 段里
// 那个字段标签是 `prose`，后端字段是 `hero_prose`。owner 照着那句话点进 /admin/page，
// 找不到它说的东西。robots 是真开关，
// indexing stats 是真计数 + owner 可选统计范围（默认全含）。
//
// 已删：regenerate-sitemap 按钮（sitemap 实时算，无「待重算」）、twitter handle
// （死字段）。

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
      <SectionHeader kicker="settings · search" title="seo" />
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
      <LabeledInput label="site title" testid="seo-site-title" value={form.site_title}
        onChange={(v) => setForm({ ...form, site_title: v })} placeholder="Your public site title" />
      <LabeledInput label="og template" testid="seo-og-template" value={form.og_template}
        onChange={(v) => setForm({ ...form, og_template: v })} placeholder="og:image template (optional)" />
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

function LabeledInput({ label, testid, value, onChange, placeholder }: {
  label: string; testid: string; value: string;
  onChange: (v: string) => void; placeholder: string;
}) {
  return (
    <label className="block">
      <div className="sm-smallcaps mb-1">{label}</div>
      <input type="text" data-testid={testid} value={value} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="sm-field-input" />
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

// MirrorEditLink —— 「这个值在别处编辑」那条链接，**只有这一处**。
//
// 之前 og:description 那条是大号衬线（跟着说明段的排版走），canonical host 那条是小号等宽
// （跟着主机名的排版走）—— 同样的去处、同样的语义，长成两种东西（UX-74①）。原因是它们
// 各自继承父段落的字体，而不是自己声明。这里把它固定成一种，跟周围正文用什么字体无关。
function MirrorEditLink({ testid }: { testid: string }) {
  const t = useTranslations('adminCorpus.seo');
  return (
    <a data-testid={testid} href="/admin/page"
      className="mono text-[11px] tracking-[0.04em] text-(--color-accent) underline whitespace-nowrap">
      {t('editOnPage')}
    </a>
  );
}

// DescriptionMirror —— og:description 复用 page 的 hero prose，只读 + 跳 /admin/page 编辑。
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

// CanonicalMirror —— canonical host = owner.public_url，只读 + 跳 /admin/domain 编辑。
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

// IndexingCard —— 真计数 + owner 选统计范围（默认三 tier 全含），总数按 scope 求和。
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
