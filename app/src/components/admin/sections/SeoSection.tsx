// SeoSection —— /admin/seo。design 源 admin.js SeoSection (2369-2417)。
// defaults form (site_title / description / twitter / canonical / robots) +
// indexing stats (pages / outputs / posts) + og cover preview。

'use client';

import { SectionHeader } from '@/components/admin/SectionHeader';

export function SeoSection() {
  return (
    <>
      <SectionHeader
        kicker="settings · search"
        title="seo"
        action={<button className="sm-btn sm-btn-outline sm-btn-sm" type="button" data-testid="seo-regenerate">regenerate sitemap</button>}
      />
      <Intro />
      <div className="grid grid-cols-1 lg:grid-cols-[1.3fr_1fr] gap-6">
        <DefaultsCard />
        <RightCol />
      </div>
    </>
  );
}

function Intro() {
  return (
    <p className="reading text-[14.5px] text-(--color-muted) mb-6 max-w-[54em]">
      Defaults applied across the public site. Per-output / per-post SEO overrides live with the individual entry.
      Edit here for global site title, description, og image, and robots.
    </p>
  );
}

function DefaultsCard() {
  return (
    <div className="border border-(--color-rule) rounded-[3px] p-4 bg-(--color-surface)/50">
      <div className="sm-smallcaps mb-3">defaults</div>
      <div className="flex flex-col gap-4">
        <FieldBlock label="site title" value="standmeet" />
        <FieldBlock label="default description" value="A retrievable corpus. Ask me anything." />
        <div className="grid grid-cols-2 gap-4">
          <FieldBlock label="twitter handle" value="@—" />
          <FieldBlock label="canonical host" value="—" mono />
        </div>
        <FieldBlock label="robots" value="index, follow" />
      </div>
    </div>
  );
}

function RightCol() {
  return (
    <div className="flex flex-col gap-4">
      <IndexingCard />
      <OgCard />
    </div>
  );
}

function IndexingCard() {
  return (
    <div className="border border-(--color-rule) rounded-[3px] p-4 bg-(--color-surface)/50" data-testid="seo-indexing">
      <div className="sm-smallcaps mb-3">indexing</div>
      <div className="grid grid-cols-3 gap-3">
        <IndexStat label="pages" value="—" />
        <IndexStat label="outputs" value="—" />
        <IndexStat label="posts" value="—" />
      </div>
      <div className="mono text-[10px] text-(--color-faint) tracking-[0.06em] mt-3 leading-[1.6]">
        sitemap · auto · regenerated every 6h
      </div>
    </div>
  );
}

function IndexStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-(--color-rule) rounded-[3px] p-3 bg-(--color-surface)/30">
      <div className="sm-smallcaps mb-1">{label}</div>
      <div className="font-serif text-(--color-ink) text-[28px] tabular-nums leading-none">{value}</div>
    </div>
  );
}

function OgCard() {
  return (
    <div className="border border-(--color-rule) rounded-[3px] p-4 bg-(--color-surface)/50">
      <div className="sm-smallcaps mb-2">og · default cover</div>
      <div
        className="h-[100px] border border-(--color-rule) rounded-[3px] relative overflow-hidden"
        // gradient mimics design amber-tinted OG preview
      >
        <span className="absolute bottom-2.5 left-3 font-serif text-[18px] text-(--color-ink)">
          standmeet
        </span>
      </div>
      <button className="sm-btn sm-btn-ghost sm-btn-sm mt-2" type="button">upload custom og</button>
    </div>
  );
}

function FieldBlock({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div data-testid={`seo-${label.replace(/\s+/g, '-')}`}>
      <div className="sm-smallcaps mb-1">{label}</div>
      <div className={`border border-(--color-rule) rounded-[3px] px-3 py-2 text-(--color-ink) text-[14px] ${mono ? 'mono tracking-[0.04em]' : 'reading'}`}>
        {value}
      </div>
    </div>
  );
}
