// WritingsIndex —— the /writings landing page. time-desc lead + archive
// list + tag chip filter + infinite scroll (WritingsScrollLoader).
//
// `?tag=<name>` goes through URLSearchParams (genuinely shareable); writings
// go through zustand. Design sourced from blog.js IndexView.

'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';

import { useCorpusHref } from '@/lib/corpus/use-corpus-href';
import type { WritingView } from '@/lib/api/public';
import { WritingsScrollLoader } from '@/components/writings/WritingsScrollLoader';
import { WritingCardLead, WritingRow } from '@/components/writings/WritingCards';
import { FloatingChatDock } from '@/components/visitor/FloatingChatDock';
import { SessionStrip } from '@/components/visitor/SessionStrip';
import { useWritingsFeed } from '@/lib/writings/use-writings-feed';

interface Props {
  initialWritings: WritingView[];
  initialCursor?: string;
}

export function WritingsIndex({ initialWritings, initialCursor }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const activeTag = params.get('tag');
  const feed = useWritingsFeed();
  useFeedHydration(initialWritings, initialCursor);
  const filtered = filterByTag(feed.writings, activeTag);
  const pickTag = (t: string | null) => navigateTag(router, t);
  return (
    <div className="min-h-screen bg-(--color-paper) text-(--color-ink) font-serif">
      <SessionStrip />
      <WritingsTopBar />
      <main className="max-w-[1080px] mx-auto px-6 lg:px-0 pb-24">
        <WritingsIndexHeader
          writings={feed.writings}
          activeTag={activeTag}
          onPickTag={pickTag}
          filteredCount={filtered.length}
        />
        <WritingsIndexBody activeTag={activeTag} writings={filtered} onPickTag={pickTag} />
        <WritingsScrollLoader done={feed.done} loading={feed.loading} onHit={feed.loadMore} />
        <AskCorpusCTA hasWritings={feed.writings.length > 0} />
        <RecommendedRail writings={feed.writings} />
      </main>
      <FloatingChatDock />
    </div>
  );
}

// AskCorpusCTA —— the "or skip the reading" at the end of the writings
// index, pointing the visitor back to `/` to chat with the AI directly;
// shown only when there are articles (an empty corpus shows no pointer).
// Design source: the closing section of docs/design/project/blog.js
// IndexView.
function AskCorpusCTA({ hasWritings }: { hasWritings: boolean }) {
  const t = useTranslations('writings.index');
  return hasWritings ? (
    <section className="mt-24 pt-10 border-t border-(--color-rule)">
      <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr] gap-10 items-baseline">
        <div>
          <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-2">
            {t('orSkipTheReading')}
          </div>
          <h3 className="font-serif text-(--color-ink) text-[30px] leading-[1.15] tracking-[-0.012em] font-normal">
            {t('askHeading')}<span className="text-(--color-accent)">.</span>
          </h3>
          <p className="reading text-(--color-muted) mt-3 text-[17px]">
            {t('askBody')}
          </p>
        </div>
        <div className="md:pl-10">
          <Link
            href="/"
            className="mono text-[11px] tracking-[0.16em] uppercase text-(--color-ink) border border-(--color-ink) px-4 py-3 inline-block hover:bg-(--color-ink) hover:text-(--color-paper) transition-colors"
          >
            <span data-testid="writings-ask-cta">{t('openTheChat')}</span>
          </Link>
        </div>
      </div>
    </section>
  ) : null;
}

function RecommendedRail({ writings }: { writings: WritingView[] }) {
  const t = useTranslations('writings.index');
  const recommended = writings.slice(0, 2);
  return recommended.length >= 2 ? (
    <section className="mt-16 pt-8 border-t border-(--color-rule)">
      <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-5">
        {t('ifYouOnlyReadTwo')}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {recommended.map((w) => (
          <RecommendedCard key={w.slug} writing={w} />
        ))}
      </div>
    </section>
  ) : null;
}

function RecommendedCard({ writing }: { writing: WritingView }) {
  const t = useTranslations('writings.common');
  const href = useCorpusHref();
  return (
    <Link
      href={href({ genre: 'writing', slug: writing.slug })}
      className="block border border-(--color-rule) rounded-[3px] p-5 hover:border-(--color-ink) transition-colors"
    >
      <h4 className="font-serif text-[18px] text-(--color-ink) font-normal leading-[1.3] mb-2">
        {writing.title}
      </h4>
      <p className="reading text-[14px] text-(--color-muted) line-clamp-2">{writing.excerpt}</p>
      <div className="mono text-[10px] tracking-[0.12em] text-(--color-faint) mt-3">
        {t('readMinutes', { minutes: writing.read_minutes })}
      </div>
    </Link>
  );
}

function filterByTag(writings: WritingView[], tag: string | null): WritingView[] {
  return tag ? writings.filter((w) => w.tags.includes(tag)) : writings;
}

function useFeedHydration(initialWritings: WritingView[], initialCursor?: string) {
  const hydrate = useWritingsFeed((s) => s.hydrate);
  useEffect(() => {
    hydrate(initialWritings, initialCursor);
  }, [initialWritings, initialCursor, hydrate]);
}

function navigateTag(router: ReturnType<typeof useRouter>, tag: string | null) {
  const qs = new URLSearchParams();
  tag && qs.set('tag', tag);
  const suffix = qs.toString();
  router.push('/writings' + (suffix ? '?' + suffix : ''));
}

function WritingsTopBar() {
  const t = useTranslations('writings');
  return (
    <header className="flex items-center justify-between px-6 lg:px-10 pt-6 pb-4">
      <div className="mono text-[11px] tracking-[0.14em] uppercase flex items-baseline gap-3">
        <Link href="/" className="text-(--color-ink)">{t('common.brand')}</Link>
        <span className="text-(--color-faint) mx-1">·</span>
        <span className="text-(--color-accent)">{t('common.writings')}</span>
      </div>
      <Link
        href="/"
        className="mono text-[11px] tracking-[0.14em] uppercase text-(--color-muted) hover:text-(--color-ink)"
      >
        {t('index.chat')}
      </Link>
    </header>
  );
}

function WritingsIndexHeader({
  writings, activeTag, onPickTag, filteredCount,
}: {
  writings: WritingView[];
  activeTag: string | null;
  filteredCount: number;
  onPickTag: (t: string | null) => void;
}) {
  return (
    <section className="pt-12 lg:pt-16 pb-8 border-b border-(--color-rule)">
      <WritingsTitleBlock />
      <WritingsTagBar
        writings={writings}
        activeTag={activeTag}
        filteredCount={filteredCount}
        onPickTag={onPickTag}
      />
    </section>
  );
}

function WritingsTitleBlock() {
  const t = useTranslations('writings.index');
  return (
    <>
      <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-5">{t('essays')}</div>
      <h1 className="font-serif text-(--color-ink) text-[clamp(48px,7vw,80px)] font-[380] tracking-[-0.022em] leading-[0.98]">
        {t('title')}<span className="text-(--color-accent)">.</span>
      </h1>
      <p className="italic text-(--color-muted) mt-5 max-w-[34em] text-[21px] leading-[1.45] font-[380]">
        {t('lede')}
      </p>
    </>
  );
}

function WritingsTagBar({
  writings, activeTag, filteredCount, onPickTag,
}: {
  writings: WritingView[];
  activeTag: string | null;
  filteredCount: number;
  onPickTag: (t: string | null) => void;
}) {
  const t = useTranslations('writings.index');
  return (
    <div className="mt-8">
      <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-3 flex items-baseline justify-between flex-wrap gap-2">
        <span>{t('browseByTag')}</span>
        <ClearTagButton
          activeTag={activeTag}
          filteredCount={filteredCount}
          totalCount={writings.length}
          onClear={() => onPickTag(null)}
        />
      </div>
      <TagChipRow writings={writings} active={activeTag} onPick={onPickTag} />
    </div>
  );
}

function ClearTagButton({
  activeTag, filteredCount, totalCount, onClear,
}: {
  activeTag: string | null;
  filteredCount: number;
  totalCount: number;
  onClear: () => void;
}) {
  const t = useTranslations('writings.index');
  return activeTag ? (
    <button
      type="button"
      onClick={onClear}
      className="text-(--color-faint) hover:text-(--color-ink) lowercase tracking-[0.06em] text-[10px]"
    >
      {t('clear', { filtered: filteredCount, total: totalCount })}
    </button>
  ) : null;
}

function TagChipRow({
  writings, active, onPick,
}: {
  writings: WritingView[];
  active: string | null;
  onPick: (t: string | null) => void;
}) {
  const t = useTranslations('writings.index');
  const counts = countTags(writings);
  const tags = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
  return (
    <div className="flex flex-wrap items-baseline gap-1.5" data-testid="writings-tag-row">
      <ChipButton active={!active} onClick={() => onPick(null)}>
        {t('all')} <span className="ml-1 opacity-60 tabular-nums">{writings.length}</span>
      </ChipButton>
      {tags.map((tag) => (
        <ChipButton
          key={tag}
          active={active === tag}
          testid={`writings-tag-${tag}`}
          onClick={() => onPick(active === tag ? null : tag)}
        >
          {tag} <span className="ml-1 opacity-60 tabular-nums">{counts.get(tag) ?? 0}</span>
        </ChipButton>
      ))}
    </div>
  );
}

function countTags(writings: WritingView[]): Map<string, number> {
  const counts = new Map<string, number>();
  writings.forEach((w) => w.tags.forEach((t) => counts.set(t, (counts.get(t) ?? 0) + 1)));
  return counts;
}

function ChipButton({
  active, onClick, testid, children,
}: { active: boolean; onClick: () => void; testid?: string; children: React.ReactNode }) {
  const cls = active
    ? 'bg-(--color-ink) text-(--color-paper) border-(--color-ink)'
    : 'text-(--color-muted) border-(--color-rule) hover:text-(--color-ink)';
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testid}
      className={`mono text-[10.5px] tracking-[0.05em] uppercase border px-2 py-0.5 rounded-[2px] ${cls}`}
    >
      {children}
    </button>
  );
}

function WritingsIndexBody({
  activeTag, writings, onPickTag,
}: {
  activeTag: string | null;
  writings: WritingView[];
  onPickTag: (t: string | null) => void;
}) {
  return writings.length === 0
    ? <EmptyState />
    : <PopulatedBody activeTag={activeTag} writings={writings} onPickTag={onPickTag} />;
}

function EmptyState() {
  const t = useTranslations('writings.index');
  return (
    <section className="py-20 text-center" data-testid="writings-empty">
      <p className="italic text-(--color-muted) text-[18px]">{t('empty')}</p>
    </section>
  );
}

function PopulatedBody({
  activeTag, writings, onPickTag,
}: {
  activeTag: string | null;
  writings: WritingView[];
  onPickTag: (t: string | null) => void;
}) {
  return activeTag
    ? <FilteredList tag={activeTag} writings={writings} />
    : <LeadAndArchive writings={writings} onPickTag={onPickTag} />;
}

function LeadAndArchive({
  writings, onPickTag,
}: {
  writings: WritingView[];
  onPickTag: (t: string) => void;
}) {
  const lead = writings[0];
  return lead
    ? <LeadAndArchiveContent lead={lead} rest={writings.slice(1)} onPickTag={onPickTag} />
    : <EmptyState />;
}

function LeadAndArchiveContent({
  lead, rest, onPickTag,
}: {
  lead: WritingView;
  rest: WritingView[];
  onPickTag: (tag: string) => void;
}) {
  const t = useTranslations('writings.index');
  return (
    <>
      <section className="pt-12">
        <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-7">{t('mostRecent')}</div>
        <WritingCardLead writing={lead} onPickTag={onPickTag} />
      </section>
      <section className="mt-4">
        <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-2">{t('archive')}</div>
        {rest.map((w, i) => <WritingRow key={w.slug} writing={w} idx={i + 2} />)}
      </section>
    </>
  );
}

function FilteredList({ tag, writings }: { tag: string; writings: WritingView[] }) {
  const t = useTranslations('writings.index');
  return (
    <section className="pt-10">
      <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-2 flex items-baseline gap-3">
        <span>{t('filteredBy')}</span>
        <span className="text-(--color-accent)">#{tag}</span>
        <span className="text-(--color-faint)">·</span>
        <span className="tabular-nums">
          {t('essayCount', { count: writings.length })}
        </span>
      </div>
      <div>
        {writings.map((w, i) => <WritingRow key={w.slug} writing={w} idx={i + 1} />)}
      </div>
    </section>
  );
}
