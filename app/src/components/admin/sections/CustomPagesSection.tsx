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

import { useTranslations } from 'next-intl';

import { PagePreview } from '@/components/admin/sections/custom-pages/PagePreview';
import Link from 'next/link';

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
      <CustomPagesBody hook={hook} />
      <AuthoringPanel hook={hook} />
    </>
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

function CustomPagesBody({ hook }: { hook: CustomPagesHook }) {
  const map = {
    loading: <ListSkeleton count={3} />,
    error: <ErrorBlock message={hook.error ?? ''} />,
    empty: <EmptyState />,
    list: <CustomPagesTable rows={hook.rows} />,
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

function CustomPagesTable({ rows }: { rows: readonly CustomPageSummary[] }) {
  return (
    <div data-testid="custom-pages-list" className="border border-(--color-rule) rounded-[3px] overflow-hidden">
      <table className="w-full border-collapse">
        <TableHead />
        <tbody>
          {rows.map((p) => <PageRows key={p.id} page={p} />)}
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

// PageRows —— two rows per page: one metadata row, one showing **what it looks
// like**.
//
// The preview belongs on the same row as its metadata, so it isn't split into a
// separate column or drawer: while the owner is directing an agent to make changes,
// status and appearance need to sit in the same view — switching back and forth
// would just leave him guessing.
function PageRows({ page }: { page: CustomPageSummary }) {
  return (
    <>
      <PageRow page={page} />
      <tr className="border-b border-(--color-rule)/60 last:border-b-0">
        <td colSpan={6} className="p-0">
          <PagePreview page={page} />
        </td>
      </tr>
    </>
  );
}

function PageRow({ page }: { page: CustomPageSummary }) {
  return (
    <tr data-testid={`custom-page-row-${page.slug}`} className="border-b border-(--color-rule)/60">
      <PageCell page={page} />
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

function PageCell({ page }: { page: CustomPageSummary }) {
  const t = useTranslations('adminPages.customPages');
  return (
    <td className="px-4 py-3">
      <div className="font-serif text-[16px] text-(--color-ink)">{page.title}</div>
      <div className="mono text-[10px] text-(--color-faint) mt-0.5">{t('slugPath', { slug: page.slug })}</div>
    </td>
  );
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

