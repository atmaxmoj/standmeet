// WikiReaderClient —— F-L-11 bearer-aware reader body.
//
// The reader page (Server Component) SSR-fetches the landing anonymously (published-only, for SEO/
// crawlers). The owner's access model is "published (anonymous) + code (invited scope)", so a viewer
// WITH a code must be able to READ the entries their code opens — but SSR can't see the visitor's
// localStorage token, so a gated-but-in-scope entry comes back null and the page would show
// RestrictedDoc. This client wrapper takes the SSR result as `initialWiki`; when it's null it re-
// fetches the landing (and context) WITH the stored token on mount and renders the entry if the
// backend serves it (in the code role's corpus glob). No token / out of scope → the RestrictedDoc it
// already showed stands. Published entries keep their fast SSR path untouched.

'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { useCorpusHref } from '@/lib/corpus/use-corpus-href';
import { ChatMarkdown } from '@/components/page/markdown';
import { Attachments, CoverImage } from '@/components/visitor/CorpusMedia';
import { coverURL, expandBody } from '@/lib/corpus/media';
import { CorpusContent } from '@/components/page/CorpusContent';
import { FloatingChatDock } from '@/components/visitor/FloatingChatDock';
import { LanguageSwitch } from '@/components/visitor/LanguageSwitch';
import { ReaderAboutCard } from '@/components/visitor/ReaderAboutCard';
import { RestrictedDoc } from '@/components/visitor/RestrictedDoc';
import { WikiScopedSubEntries } from '@/components/visitor/WikiScopedSubEntries';
import { loadScopedLanding, type WikiLandingEntry } from '@/lib/visitor/scoped-reader';
import type { TreeContext, TreeNode } from '@/lib/corpus/tree';

import styles from '@/app/wiki/[...path]/wiki-landing.module.css';

export type WikiRef = { path: string; title: string };

// WikiEntry —— the note the reader reads, **exactly** the shape parsed
// from the landing payload (see `parseWikiLanding`). This used to have a
// separate hand-written camelCase type plus a mapping function that only
// the client-side refetch path ever called; the SSR path passed the
// backend payload straight through, and the fields that happened to share
// names on both sides were just enough to pass the type check — so a
// published note's hero image, hero headline, and inline images all
// silently vanished (F-L-33). One shape, with no second copy to drop
// fields from.
export type WikiEntry = WikiLandingEntry;

export function WikiReaderClient({
  initialWiki, handle, ownerName, slug, initialCtx, lang = '',
}: {
  initialWiki: WikiEntry | null; handle: string; ownerName: string; slug: string;
  initialCtx: TreeContext; lang?: string;
}) {
  // **Derived, not a prop copied into state.**
  //
  // This used to be `useState(initialWiki)`, and `useState`'s initial value
  // is **only ever read on the first mount**: after that, if the prop
  // changes, the state doesn't budge. Full page reloads never exposed
  // this — every navigation was a fresh mount, so the initial value was
  // naturally new each time. Once the switcher moved to client-side
  // navigation, React reused the same component instance, and the
  // server's already-updated `initialWiki` for the Chinese version was
  // silently ignored — the URL changed but the screen stayed in English.
  //
  // The shape matches the same pattern elsewhere in this repo
  // (`WikiIndexRoots`'s `scoped ?? roots`, `TreeStats`'s `scoped ?? stats`):
  // the SSR copy is the anonymous-view fallback, overridden by the
  // token-bearing refetch.
  const { wiki, ctx } = useScopedLanding(slug, initialWiki, initialCtx, lang);
  return wiki
    ? (
      <WikiLandingContent
        wiki={wiki} handle={handle} ownerName={ownerName} slug={slug} ctx={ctx}
      />
    )
    : <RestrictedDoc genre="wiki" slug={slug} />;
}

// useScopedLanding —— pairs the SSR copy (anonymous view) with a
// token-bearing refetch (invited view); use the latter when it's available.
function useScopedLanding(
  slug: string, initialWiki: WikiEntry | null, initialCtx: TreeContext, lang: string,
): { wiki: WikiEntry | null; ctx: TreeContext } {
  const [scoped, setScoped] = useState<WikiEntry | null>(null);
  const [scopedCtx, setScopedCtx] = useState<TreeContext | null>(null);
  useEffect(
    () => loadScopedLanding(slug, initialWiki !== null, setScoped, setScopedCtx, lang),
    [initialWiki, slug, lang],
  );
  return { wiki: scoped ?? initialWiki, ctx: scopedCtx ?? initialCtx };
}

function WikiLandingContent({ wiki, handle, ownerName, slug, ctx }: {
  wiki: WikiEntry; handle: string; ownerName: string; slug: string; ctx: TreeContext;
}) {
  // Top bar / session strip / tree have all moved to `wiki/layout.tsx`:
  // Next **preserves the layout** when navigating between sibling pages,
  // so switching articles no longer remounts the whole shell (the tree
  // doesn't flash, nothing refetches per level), and the shell stays fixed
  // with only the body scrolling on its own. This component renders only
  // this one article's own content.
  return (
    <div data-testid="wiki-landing" className="pt-10 pb-24">
      <Breadcrumb ancestors={ctx.ancestors} current={wiki.title} />
      <OgCoverMaybe entry={wiki} seed={slug} />
      <MetaStrip entry={wiki} ownerName={ownerName} />
      <div className="max-w-[680px] mx-auto mt-3">
        <LanguageSwitch languages={wiki.languages ?? []} current={wiki.lang ?? ''} />
      </div>
      <article className="max-w-[680px] mx-auto mt-2">
        <WikiBody
          body={wiki.body} assetURLs={wiki.asset_urls} cssClasses={wiki.css_classes}
        />
        <Attachments assets={wiki.assets} testid="wiki-attachments" />
      </article>
      <div className="max-w-[760px] mx-auto">
        <WikiScopedSubEntries slug={slug} initial={ctx.children} />
        <RelatedRail items={wiki.related} title="read next" testid="related-rail-read-next" />
        <RelatedRail items={wiki.cited_by} title="cited by" testid="related-rail-cited-by" />
        <ReaderAboutCard genre="wiki" handle={handle} />
      </div>
      <FloatingChatDock docContext={{ title: wiki.title, path: slug, genre: 'wiki' }} />
    </div>
  );
}

// OgCoverMaybe —— the hero is something the owner **set on purpose**: the
// trio (image / headline sitting on the image / hue). None of them set =
// this note has no hero, and nothing renders up top.
//
// It used to unconditionally lay down a 21:9 (about 400px) block. With no
// cover image, that block was a slug-hashed gradient printing only the
// title and date — both of which already have a copy in the meta line
// below. On a real vault's dense math note, the first screen was almost
// entirely an empty colored block, pushing the body below the fold.
// corpus-media's check 4 spelled this out twice, verbatim: "An entry with
// no hero renders no empty hero shell" (F-L-32).
function OgCoverMaybe({ entry, seed }: { entry: WikiEntry; seed: string }) {
  return hasHero(entry) ? <OgCover entry={entry} seed={seed} /> : null;
}

// hasHero —— only something the owner **actually wrote in** counts as
// wanting this hero: a cover image, or the headline sitting on top of it.
//
// ⚠️ **The hue is not evidence**, even when it has a value.
// `corpus_notes.cover_hue` is `NOT NULL DEFAULT 'amber'`
// (`backend/db/schema.sql:192`), so every note reads back with `amber` —
// including all 575 of them the owner never opened the hero editor for.
// Treating "hue is non-empty" as "he picked a hue" makes this check
// **vacuously true** across the entire real corpus, which would make
// F-L-32's fix a no-op (same trap as the `— default —` option in the admin
// form: saving it still writes `amber`; the "unset" state simply has no
// representation in the database at all). This was found by driving
// corpus-acl-editing in the real environment: the form showed "HUE: amber"
// for a note that clearly had no cover, which led back through the schema
// to this.
function hasHero(entry: WikiEntry): boolean {
  return entry.cover_image_asset_id !== '' || entry.cover_headline !== '';
}

function OgCover({ entry, seed }: { entry: WikiEntry; seed: string }) {
  const { head, sub } = splitTitle(entry.title);
  return (
    <div
      className={styles['cover']}
      data-hue={heroHue(entry.cover_hue, seed)}
      data-testid="wiki-cover"
    >
      <CoverImage
        url={coverURL(entry.cover_image_asset_id, entry.asset_urls)} testid="wiki-cover-image"
      />
      <CoverVeilMaybe id={entry.cover_image_asset_id} />
      <span className={styles['tag']}>{coverTag(entry.tags)}</span>
      <span className={styles['no']}>{formatDate(entry.updated_at)}</span>
      <span className={styles['head']}>{entry.cover_headline || head}</span>
      {sub ? <span className={styles['sub']}>{sub}</span> : null}
    </div>
  );
}

// CoverVeilMaybe —— lays a text-protection veil only when there's a cover
// image (UX-83). **Position is layering**: after the image, before the
// four text lines.
//
// Why it's needed: in the real environment, a note was set up with a
// busy, text-dense real photo as its cover, and `cover_headline` was laid
// directly on top — text and background image blurred together
// illegibly. CI can never surface this — its fixture is a 1×1 pixel, so
// any text laid over it "passes". Doesn't render without an image: that
// kind of cover is just paper color + a hue gradient, and there's nothing
// to protect.
function CoverVeilMaybe({ id }: { id: string }) {
  return id === '' ? null : <div className={styles['veil']} />;
}

// coverTag —— the small label in the cover's top-left corner. No tag →
// write just the genre.
function coverTag(tags: readonly string[]): string {
  return tags[0] ? `wiki · ${tags[0]}` : 'wiki';
}

function MetaStrip({ entry, ownerName }: { entry: WikiEntry; ownerName: string }) {
  const t = useTranslations('reader');
  return (
    <header className="mt-8 mb-9" data-testid="wiki-meta">
      <div className="smallcaps flex items-baseline gap-2.5 flex-wrap mb-3">
        <span>{formatDate(entry.updated_at)}</span>
        <span className="text-(--color-faint)">·</span>
        <span>{t('wiki.by')} <span className="text-(--color-ink)">{ownerName}</span></span>
        {entry.tags.map((tag) => (
          <Link key={tag} href={`/writings?tag=${encodeURIComponent(tag)}`} className="ml-1.5 no-underline">
            <span className="mono text-[10px] tracking-[0.1em] text-(--color-muted) border border-(--color-rule) rounded-[2px] px-1.5 py-0.5 hover:text-(--color-ink)">
              #{tag}
            </span>
          </Link>
        ))}
      </div>
      <h1 className="font-serif text-(--color-ink) text-[clamp(36px,5vw,56px)] font-[380] tracking-[-0.022em] leading-[1.04] text-pretty">
        {entry.title}
      </h1>
      {entry.excerpt && (
        <p className="font-serif italic text-(--color-muted) text-[22px] leading-[1.45] font-[380] mt-4 max-w-[34em] text-pretty">
          {entry.excerpt}
        </p>
      )}
    </header>
  );
}

// Breadcrumb —— **answers only "where am I"**.
//
// It used to also carry `{date} · {count} sources cited` on the right
// end, while the same two facts each had their own copy in the meta line
// below (`… · BY … · 0 CORPUS SOURCES`) — saying the same thing twice on
// one screen, in different words to boot (UX-85). This duplication used
// to be recorded as "left for the owner to decide", on the grounds that
// the `wiki-meta-row.spec.ts` guard's name explicitly said both places
// each say it once. **That guard was recording the duplication itself,
// not a product requirement** ([[parked-test-carries-a-wrong-diagnosis]]):
// the criterion (say each fact once per screen) wins, and the guard was
// changed to match.
//
// The division of labor is now fixed: the breadcrumb is navigation, the
// meta line talks about this note (who wrote it, when, how many citations).
function Breadcrumb({ ancestors, current }: {
  ancestors: TreeNode[]; current: string;
}) {
  const t = useTranslations('reader');
  return (
    <nav
      className="flex items-baseline justify-between gap-4 flex-wrap mb-6"
      data-testid="wiki-breadcrumb"
    >
      <div className="smallcaps flex items-baseline gap-1.5 flex-wrap">
        <Link href="/wiki" className="text-(--color-muted) hover:text-(--color-ink)">
          {t('wiki.backToWiki')}
        </Link>
        {ancestors.map((a) => <Crumb key={a.id} node={a} />)}
        <span className="text-(--color-faint)">{'▸'}</span>
        <span className="font-serif italic text-[13px] normal-case tracking-normal text-(--color-ink)">
          {current}
        </span>
      </div>
    </nav>
  );
}

function Crumb({ node }: { node: TreeNode }) {
  const href = useCorpusHref();
  return (
    <>
      <span className="text-(--color-faint)">{'▸'}</span>
      <Link
        href={href({ genre: 'wiki', path: node.path })}
        className="font-serif italic text-[13px] normal-case tracking-normal text-(--color-muted) hover:text-(--color-ink)"
      >
        {node.title}
      </Link>
    </>
  );
}

function RelatedRail(
  { items, title, testid }: { items: readonly WikiRef[]; title: string; testid: string },
) {
  const href = useCorpusHref();
  return items.length > 0 ? (
    <div className="mt-12" data-testid={testid}>
      <div className="smallcaps mb-3">{title}</div>
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1.5 list-none p-0 m-0">
        {items.map((r) => (
          <li key={r.path}>
            <Link
              href={href({ genre: 'wiki', path: r.path })}
              className="reading text-(--color-ink) hover:text-(--color-accent) text-[15px]"
            >
              {r.title} <span className="text-(--color-faint)">→</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  ) : null;
}

function WikiBody(
  { body, assetURLs, cssClasses }:
  { body: string; assetURLs?: Readonly<Record<string, string>>; cssClasses?: readonly string[] },
) {
  // The body stores the stable `standmeet-asset:<id>` URI (never expires),
  // swapped for a pre-signed URL only at render time. Without this swap,
  // react-markdown's urlTransform strips this non-standard scheme — the
  // image slot ends up empty, with no error, so skipping this step goes
  // unnoticed by anyone.
  const rendered = expandBody(body, assetURLs);
  return (
    <div className="reading" data-testid="wiki-body">
      <CorpusContent classes={cssClasses}>
        <ChatMarkdown source={rendered} variant="article" />
      </CorpusContent>
    </div>
  );
}

// heroHue —— which hue to use for coloring. **The owner's own pick takes
// priority**: he picked "acid" in the hero editor, the backend stored it,
// and the payload carried it — while this used to just hash the slug
// directly, so that choice never made it to the page (F-L-34). Only when
// he didn't pick one (set only an image, or only wrote a headline) does it
// derive one from the slug — the same note always gets the same color.
function heroHue(chosen: string, seed: string): Hue {
  return isHue(chosen) ? chosen : hashHue(seed);
}

const HUES = ['amber', 'violet', 'acid'] as const;
type Hue = (typeof HUES)[number];

function isHue(v: string): v is Hue {
  return HUES.some((h) => h === v);
}

function hashHue(seed: string): Hue {
  const sum = [...seed].reduce((a, c) => a + c.charCodeAt(0), 0);
  return HUES[sum % HUES.length] ?? 'amber';
}

function splitTitle(title: string): { head: string; sub: string } {
  const parts = title.split(/\.\s+|:\s+/);
  return { head: parts[0] ?? title, sub: parts.slice(1).join('. ') };
}

function formatDate(iso: string): string {
  return iso.slice(0, 10);
}
