// CustomPagesSection —— /admin/custom-pages. React sub-pages the owner creates via
// MCP, plus their status and a "view live ↗" link.
//
// Design source: docs/design/project/admin.js PagesSection: an intro paragraph +
// table (page · template · visibility · updated · actions) + a "templates available"
// 4-cell grid. The template field schema doesn't exist yet — show the available
// templates statically for now so the owner knows which one to use next.
//
// Write operations (create/build/promote) don't live in admin — the owner calls them
// via MCP driver in Claude; admin here only confirms status.

'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

import Link from 'next/link';

// HOMEPAGE_SLUG — the reserved custom-page slug served at `/` (backend usecase.HomepageSlug). The
// list marks this row so the owner can tell which page is their public homepage at a glance.
const HOMEPAGE_SLUG = 'home';

import { SectionHeader } from '@/components/admin/SectionHeader';
import { AuthoringPanel } from '@/components/admin/sections/custom-pages/AuthoringPanel';
import { ListSkeleton } from '@/components/skeletons/ListSkeleton';
import {
  pickCustomPagesBodyState,
  useCustomPages,
  type CustomPagesHook,
  type CustomPageSummary,
} from '@/lib/admin/use-custom-pages';
import { useAction } from '@/lib/ui/use-action';
import { stampDay } from '@/lib/ui/format-time';

export function CustomPagesSection() {
  const hook = useCustomPages();
  // The page whose split editor|preview is open below. Empty = the "new page" state (editable slug).
  const [selectedSlug, setSelectedSlug] = useState('');
  return (
    <>
      <SectionHeader
        // kicker must match the sidebar's grouping. This line used to read
        // "corpus · microsites" — but this entry has since moved to the access group
        // (a page is something a visitor sees, not a genre of corpus). Moving the
        // nav item only changed the nav; this page's own line stayed put, so the same
        // thing belonged to two different groups ([[vocabulary-must-not-diverge]]).
        // Only visible on a real-prod eyeball check.
        kicker="access · microsites"
        slug="custom-pages"
        count={hook.rows.length > 0 ? String(hook.rows.length) : ''}
      />
      <Intro />
      <NewPageButton onNew={() => setSelectedSlug('')} />
      <CustomPagesBody hook={hook} selectedSlug={selectedSlug} onSelect={setSelectedSlug} />
      <AuthoringPanel hook={hook} slug={selectedSlug} onSlugChange={setSelectedSlug} />
    </>
  );
}

// NewPageButton — clears the selection so the editor below opens in "new page" mode (editable slug).
function NewPageButton({ onNew }: { onNew: () => void }) {
  const t = useTranslations('adminPages.customPages');
  return (
    <div className="mb-3 flex justify-end">
      <button
        type="button" onClick={onNew} data-testid="custom-page-new"
        className="sm-btn sm-btn-sm"
      >
        {t('newPage')}
      </button>
    </div>
  );
}

function Intro() {
  const t = useTranslations('adminPages.customPages');
  return (
    <p className="reading text-[14.5px] text-(--color-muted) mb-6 max-w-[54em]">
      {t('intro.before')} <span className="mono text-(--color-ink)">{t('intro.slugPath')}</span>{t('intro.after')}
    </p>
  );
}

function CustomPagesBody(
  { hook, selectedSlug, onSelect }:
  { hook: CustomPagesHook; selectedSlug: string; onSelect: (slug: string) => void },
) {
  const map = {
    loading: <ListSkeleton count={3} />,
    error: <ErrorBlock message={hook.error ?? ''} />,
    empty: <EmptyState />,
    list: <CustomPagesTable rows={hook.rows} selectedSlug={selectedSlug} onSelect={onSelect} />,
  } as const;
  return map[pickCustomPagesBodyState(hook)];
}

function ErrorBlock({ message }: { message: string }) {
  return (
    <p className="mono text-[11px] text-(--color-accent) mt-8" data-testid="custom-pages-error">
      {message}
    </p>
  );
}

function EmptyState() {
  const t = useTranslations('adminPages.customPages');
  return (
    <p className="reading-tight italic text-(--color-muted) mt-8">
      {t('empty.lead')}{' '}
      (<span className="mono">{t('empty.toolCreate')}</span>,{' '}
      <span className="mono">{t('empty.toolWriteFile')}</span>,{' '}
      <span className="mono">{t('empty.toolBuild')}</span>,{' '}
      <span className="mono">{t('empty.toolPromote')}</span>).
    </p>
  );
}

function CustomPagesTable(
  { rows, selectedSlug, onSelect }:
  { rows: readonly CustomPageSummary[]; selectedSlug: string; onSelect: (slug: string) => void },
) {
  return (
    <div data-testid="custom-pages-list" className="border border-(--color-rule) rounded-[3px] overflow-hidden">
      <table className="w-full border-collapse">
        <TableHead />
        <tbody>
          {rows.map((p) => (
            <PageRow key={p.id} page={p} selected={p.slug === selectedSlug} onSelect={onSelect} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TableHead() {
  const t = useTranslations('adminPages.customPages.columns');
  return (
    <thead className="bg-(--color-surface)/60 mono text-[9.5px] tracking-[0.16em] uppercase text-(--color-muted)">
      <tr>
        <th className="text-left px-4 py-2.5 border-b border-(--color-rule) font-normal">{t('page')}</th>
        <th className="text-left px-4 py-2.5 border-b border-(--color-rule) font-normal">{t('template')}</th>
        <th className="text-left px-4 py-2.5 border-b border-(--color-rule) font-normal">{t('visibility')}</th>
        <th className="text-left px-4 py-2.5 border-b border-(--color-rule) font-normal">{t('access')}</th>
        <th className="text-left px-4 py-2.5 border-b border-(--color-rule) font-normal">{t('updated')}</th>
        <th className="text-right px-4 py-2.5 border-b border-(--color-rule) font-normal">{t('actions')}</th>
      </tr>
    </thead>
  );
}

// PageRow — one row per page. The previews no longer render inline (that put every page's full
// render in the list at once); instead clicking the title opens this page in the split editor|
// preview below. The row highlights when it's the one open.
function PageRow(
  { page, selected, onSelect }:
  { page: CustomPageSummary; selected: boolean; onSelect: (slug: string) => void },
) {
  return (
    <tr
      data-testid={`custom-page-row-${page.slug}`}
      className={`border-b border-(--color-rule)/60 ${selected ? 'bg-(--color-surface)/60' : ''}`}
    >
      <PageCell page={page} onSelect={onSelect} />
      <TemplateCell />
      <VisibilityCell hasLive={page.has_live} hasStaging={page.has_staging} />
      <BindingCell page={page} />
      <DateCell iso={page.updated_at} />
      <ActionsCell page={page} />
    </tr>
  );
}

// BindingCell —— which codes unlock this page. **The other end of the binding**:
// the code side sees the page, this side sees the codes. A binding visible from
// only one direction is a binding people forget they made.
function BindingCell({ page }: { page: CustomPageSummary }) {
  return (
    <td className="px-4 py-3 mono text-[10px]" data-testid={`custom-page-codes-${page.slug}`}>
      <BoundCodes codes={page.bound_codes ?? []} />
      <ByoaiToggle page={page} />
    </td>
  );
}

// BoundCodes —— which codes unlock this page.
//
// "Empty" here is not the same as the list's empty state: the row has already
// loaded, and `bound_codes` is just a field on it — empty means **genuinely no code
// points to it**, with none of the "failed-to-load looks like empty" ambiguity
// (check-one-empty-state guards against that other case).
function BoundCodes({ codes }: { codes: readonly string[] }) {
  const t = useTranslations('adminPages.customPages');
  const bound = codes.join(' · ');
  return bound !== ''
    ? <span className="text-(--color-ink)">{t('boundCodes')} {bound}</span>
    : <span className="text-(--color-faint)">{t('boundNone')}</span>;
}

// ByoaiToggle —— whether this page allows visitors to bring their own key.
//
// **Voided the moment a code is attached**: the code decides admission, this page's
// own toggle no longer has the final say ("pages give a code a rendering"). So when
// a code is attached, the control isn't hidden — it plainly states it's been
// overridden; hiding it would let the owner think their last setting still applies.
function ByoaiToggle({ page }: { page: CustomPageSummary }) {
  const bound = (page.bound_codes ?? []).length > 0;
  return bound ? <ByoaiVoid slug={page.slug} /> : <ByoaiButton page={page} />;
}

function ByoaiVoid({ slug }: { slug: string }) {
  const t = useTranslations('adminPages.customPages');
  return (
    <div className="text-(--color-faint) mt-1" data-testid={`custom-page-byoai-void-${slug}`}>
      {t('byoaiVoid')}
    </div>
  );
}

// block —— the previous version was an inline `<button>`, so it sat right after
// "which codes unlock this page", reading on screen as
// `…anonymous onlyno bring-your-own-key`: two sentences glued into one nobody could
// parse (UX-98).
function ByoaiButton({ page }: { page: CustomPageSummary }) {
  const t = useTranslations('adminPages.customPages');
  const { setByoai } = useCustomPages();
  const run = useAction();
  const allow = page.allow_byoai ?? false;
  return (
    <button
      type="button"
      className="block mono text-[10px] mt-1 text-(--color-accent) hover:underline"
      data-testid={`custom-page-byoai-${page.slug}`}
      onClick={() => void run(() => setByoai(page.slug, !allow), { success: byoaiToast(page.slug, allow) })}
    >
      {allow ? t('byoaiOn') : t('byoaiOff')}
    </button>
  );
}

function byoaiToast(slug: string, wasAllowed: boolean): string {
  return `BYOK ${wasAllowed ? 'off' : 'on'} for /p/${slug}`;
}

function TemplateCell() {
  return (
    <td className="px-4 py-3 mono text-[10px] tracking-[0.12em] text-(--color-faint)">
      —
    </td>
  );
}

function VisibilityCell({ hasLive, hasStaging }: { hasLive: boolean; hasStaging: boolean }) {
  const t = useTranslations('adminPages.customPages.visibilityState');
  const view = buildView(hasLive, hasStaging);
  return (
    <td className={`px-4 py-3 mono text-[10px] tracking-[0.12em] uppercase ${view.tone}`}>
      {t(view.key)}
    </td>
  );
}

function PageCell(
  { page, onSelect }: { page: CustomPageSummary; onSelect: (slug: string) => void },
) {
  const t = useTranslations('adminPages.customPages');
  return (
    <td className="px-4 py-3">
      <button
        type="button" onClick={() => onSelect(page.slug)}
        data-testid={`custom-page-open-${page.slug}`}
        className="block text-left hover:opacity-70"
      >
        <span className="font-serif text-[16px] text-(--color-ink)">{page.title}</span>
        <HomepageBadge slug={page.slug} />
        <span className="block mono text-[10px] text-(--color-faint) mt-0.5">
          {t('slugPath', { slug: page.slug })}
        </span>
      </button>
    </td>
  );
}

// HomepageBadge — marks the reserved `home` page, the one served at `/` (owner: "标注这个是
// homepage"). Only that one row carries it.
function HomepageBadge({ slug }: { slug: string }) {
  const t = useTranslations('adminPages.customPages');
  return slug === HOMEPAGE_SLUG ? (
    <span
      data-testid="custom-page-homepage-badge"
      className="ml-2 align-middle mono text-[8.5px] tracking-[0.14em] uppercase px-1.5 py-0.5 border border-(--color-accent) text-(--color-accent) rounded-[2px]"
    >
      {t('homepageBadge')}
    </span>
  ) : null;
}


type BuildKey = keyof typeof BUILD_TONE_MAP;

function buildView(hasLive: boolean, hasStaging: boolean): { key: BuildKey; tone: string } {
  const key: BuildKey = hasLive ? 'live' : (hasStaging ? 'staging' : 'none');
  return { key, tone: BUILD_TONE_MAP[key] };
}

const BUILD_TONE_MAP = {
  live: 'text-(--color-ink)',
  staging: 'text-(--color-amber)',
  none: 'text-(--color-faint)',
} as const;

function DateCell({ iso }: { iso: string }) {
  return (
    <td className="px-4 py-3 mono text-[10px] text-(--color-muted)">
      {stampDay(iso)}
    </td>
  );
}

// ActionsCell —— view, take down, delete. **What can go live must be revocable**:
// without the latter two, the rule "the owner takes it down in admin and visitors
// lose access" simply can't be carried out on this screen — the owner would need to
// open a Claude session and call MCP just to pull down what they just published
// (F-P-4).
function ActionsCell({ page }: { page: CustomPageSummary }) {
  return (
    <td className="px-4 py-3 text-right whitespace-nowrap">
      <ViewLiveLink page={page} />
      <TakeDownLink page={page} />
      <DeleteLink slug={page.slug} />
    </td>
  );
}

// TakeDownLink —— take the page down. The build is kept and can go live again any
// time, so this is a separate action from "delete" — actions with different
// consequences don't get merged. Not shown for a page that isn't live — something
// that can't be un-taken-down shouldn't offer a take-down entry point.
function TakeDownLink({ page }: { page: CustomPageSummary }) {
  const t = useTranslations('adminPages.customPages');
  const { rollback } = useCustomPages();
  const run = useAction();
  return page.has_live ? (
    <button
      type="button"
      data-testid={`custom-page-takedown-${page.slug}`}
      className="ml-3 mono text-[10.5px] tracking-[0.14em] uppercase text-(--color-muted) hover:text-(--color-ink)"
      onClick={() => void run(() => rollback(page.slug), { success: t('tookDown', { slug: page.slug }) })}
    >
      {t('takeDown')}
    </button>
  ) : null;
}

function DeleteLink({ slug }: { slug: string }) {
  const t = useTranslations('adminPages.customPages');
  const { removePage } = useCustomPages();
  const run = useAction();
  return (
    <button
      type="button"
      data-testid={`custom-page-delete-${slug}`}
      className="ml-3 mono text-[10.5px] tracking-[0.14em] uppercase text-(--color-muted) hover:text-(--color-accent)"
      onClick={() => void run(() => removePage(slug), { success: t('deleted', { slug }) })}
    >
      {t('delete')}
    </button>
  );
}

function ViewLiveLink({ page }: { page: CustomPageSummary }) {
  const t = useTranslations('adminPages.customPages');
  return page.has_live ? (
    <Link
      href={`/p/${page.slug}`}
      className="mono text-[10.5px] tracking-[0.14em] uppercase text-(--color-accent) hover:underline"
    >
      {t('viewLive')} ↗
    </Link>
  ) : (
    <span className="mono text-[10.5px] tracking-[0.14em] uppercase text-(--color-faint)">
      {t('noLiveBuild')}
    </span>
  );
}

// The TEMPLATES AVAILABLE block was removed: the four cards `press-kit / list-prose /
// menu / auto-now` were **pure i18n copy** — no template artifact exists anywhere in
// the repo, and `custom_page.create` doesn't even accept a template parameter.
// Displaying four things the owner can't actually get is worse than showing nothing
// ([[names-that-lie]]). Once a real template exists, hook it back up.

