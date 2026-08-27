// WritingCards —— /writings index 用到的 lead card + archive row + lead meta。
// 从 WritingsIndex 拆出来守 350-line cap。

'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { corpusHref } from '@/lib/corpus/href';
import type { WritingView } from '@/lib/api/public';
import { Cover } from '@/components/writings/Cover';

export function WritingCardLead({
  writing, onPickTag,
}: { writing: WritingView; onPickTag: (t: string) => void }) {
  const t = useTranslations('writings.cards');
  return (
    <article
      className="grid grid-cols-1 lg:grid-cols-[1.15fr_1fr] gap-10 lg:gap-12 mb-20 group"
      data-writing-card={writing.slug}
    >
      <Link href={corpusHref({ genre: 'writing', slug: writing.slug })} className="block">
        <Cover
          cover={writing}
          assetURLs={writing.asset_urls ?? {}}
          no={t('leadNo', { date: formatDate(writing.published_at) })}
        />
      </Link>
      <WritingCardLeadMeta writing={writing} onPickTag={onPickTag} />
    </article>
  );
}

function WritingCardLeadMeta({
  writing, onPickTag,
}: { writing: WritingView; onPickTag: (t: string) => void }) {
  return (
    <div className="flex flex-col">
      <WritingCardLeadKicker writing={writing} />
      <Link href={corpusHref({ genre: 'writing', slug: writing.slug })}>
        <h2 className="font-serif text-(--color-ink) group-hover:text-(--color-accent) transition-colors text-[clamp(34px,4vw,46px)] leading-[1.08] tracking-[-0.018em] font-normal">
          {writing.title}
        </h2>
      </Link>
      <p className="text-(--color-muted) mt-5 text-[18px] leading-[1.55]">
        {writing.excerpt}
      </p>
      <WritingCardLeadTagRow writing={writing} onPickTag={onPickTag} />
    </div>
  );
}

function WritingCardLeadKicker({ writing }: { writing: WritingView }) {
  const t = useTranslations('writings');
  return (
    <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-3 flex items-baseline gap-3 flex-wrap">
      <span className="text-(--color-ink)">{t('cards.latest')}</span>
      <span className="text-(--color-faint)">·</span>
      <span>{formatDate(writing.published_at)}</span>
      <span className="text-(--color-faint)">·</span>
      <span>{t('common.readMinutes', { minutes: writing.read_minutes })}</span>
    </div>
  );
}

function WritingCardLeadTagRow({
  writing, onPickTag,
}: { writing: WritingView; onPickTag: (tag: string) => void }) {
  const t = useTranslations('writings.common');
  return (
    <div className="mt-6 flex flex-wrap items-baseline gap-1.5">
      {writing.tags.map((tag) => <TagPill key={tag} tag={tag} onClick={() => onPickTag(tag)} />)}
      <span className="mono text-[11px] tracking-[0.14em] uppercase text-(--color-muted) ml-auto pt-1">
        {t('read')}
      </span>
    </div>
  );
}

function TagPill({ tag, onClick }: { tag: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mono text-[10.5px] tracking-[0.05em] uppercase border border-(--color-rule) text-(--color-muted) px-2 py-0.5 rounded-[2px] hover:text-(--color-ink)"
    >
      {tag}
    </button>
  );
}

export function WritingRow({ writing, idx }: { writing: WritingView; idx: number }) {
  const t = useTranslations('writings');
  return (
    <Link
      href={corpusHref({ genre: 'writing', slug: writing.slug })}
      className="group grid grid-cols-[60px_1fr_auto] gap-6 lg:gap-10 py-7 border-t border-(--color-rule) items-baseline"
    >
      <div
        data-writing-card={writing.slug}
        className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) tabular-nums pt-2"
      >
        {t('cards.no', { n: String(idx).padStart(2, '0') })}
      </div>
      <WritingRowBody writing={writing} />
      <div className="mono text-[11px] tracking-[0.16em] uppercase text-(--color-muted) group-hover:text-(--color-accent) pt-2 shrink-0">
        {t('common.read')}
      </div>
    </Link>
  );
}

function WritingRowBody({ writing }: { writing: WritingView }) {
  const t = useTranslations('writings.cards');
  return (
    <div>
      <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-2 flex items-baseline gap-3 flex-wrap">
        <span>{formatDate(writing.published_at)}</span>
        <span className="text-(--color-faint)">·</span>
        <span>{t('readMinutesShort', { minutes: writing.read_minutes })}</span>
      </div>
      <h3 className="font-serif text-(--color-ink) group-hover:text-(--color-accent) transition-colors text-[24px] leading-[1.2] tracking-[-0.005em] font-normal">
        {writing.title}
      </h3>
      <p className="text-(--color-muted) mt-2 max-w-[46em] text-[16.5px] leading-[1.5]">
        {writing.excerpt}
      </p>
    </div>
  );
}

function formatDate(iso?: string): string {
  return iso ? iso.slice(0, 10).replace(/-/g, '.') : '';
}
