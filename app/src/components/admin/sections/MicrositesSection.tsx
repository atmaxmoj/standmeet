// MicrositesSection —— /admin/microsites. React sub-pages the owner creates via
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

import Link from 'next/link';

import { SectionHeader } from '@/components/admin/SectionHeader';
import { ListSkeleton } from '@/components/skeletons/ListSkeleton';
import {
  pickMicrositesBodyState,
  useMicrosites,
  type MicrositesHook,
  type MicrositeSummary,
} from '@/lib/admin/use-microsites';
import { useAction } from '@/lib/ui/use-action';
import { stampDay } from '@/lib/ui/format-time';

// HOMEPAGE_SLUG — the reserved microsite slug served at `/` (backend usecase.HomepageSlug). The
// list marks this row so the owner can tell which page is their public homepage at a glance.
const HOMEPAGE_SLUG = 'home';

// MicrositesSection — /admin/microsites is JUST the list now (owner: "只是列表，不要在下面有
// 编辑器"). Editing a page happens on its own route, /admin/edit/<slug> (the mini-IDE); the list's
// title and "edit" action link there.
export function MicrositesSection() {
  const hook = useMicrosites();
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
        slug="microsites"
        count={hook.rows.length > 0 ? String(hook.rows.length) : ''}
      />
      <Intro />
      <HomepageCard />
      <NewPageButton />
      <MicrositesBody hook={hook} />
    </>
  );
}

// HomepageCard — a dedicated, always-present entry to edit the homepage microsite
// (served at `/`). The `home` page is otherwise just another row in the list — easy to
// miss, and a fresh instance's default home may not be in the list at all — so this gives
// the owner one obvious place to open it in the editor, regardless of the list below.
function HomepageCard() {
  const t = useTranslations('adminPages.microsites');
  return (
    <Link
      href={`/admin/edit/${HOMEPAGE_SLUG}`}
      className="mb-6 flex items-baseline justify-between gap-3 border border-(--color-rule) rounded-[3px] px-4 py-3 hover:border-(--color-ink) transition-colors"
    >
      <span className="min-w-0" data-testid="microsite-edit-homepage">
        <span className="block font-serif text-[16px] text-(--color-ink)">{t('homepage.title')}</span>
        <span className="block mono text-[11px] text-(--color-muted) mt-0.5">{t('homepage.hint')}</span>
      </span>
      <span className="mono text-[10px] tracking-[0.14em] uppercase text-(--color-accent) shrink-0">
        {t('homepage.edit')}
      </span>
    </Link>
  );
}

// NewPageButton — start a fresh page in the editor route (create-on-save).
function NewPageButton() {
  const t = useTranslations('adminPages.microsites');
  return (
    <div className="mb-3 flex justify-end">
      <Link href="/admin/edit/new" className="sm-btn sm-btn-sm">
        <span data-testid="microsite-new">{t('newPage')}</span>
      </Link>
    </div>
  );
}

function Intro() {
  const t = useTranslations('adminPages.microsites');
  return (
    <p className="reading text-[14.5px] text-(--color-muted) mb-6 max-w-[54em]">
      {t('intro.before')} <span className="mono text-(--color-ink)">{t('intro.slugPath')}</span>{t('intro.after')}
    </p>
  );
}

function MicrositesBody({ hook }: { hook: MicrositesHook }) {
  const map = {
    loading: <ListSkeleton count={3} />,
    error: <ErrorBlock message={hook.error ?? ''} />,
    empty: <EmptyState />,
    list: <MicrositesTable rows={hook.rows} />,
  } as const;
  return map[pickMicrositesBodyState(hook)];
}

function ErrorBlock({ message }: { message: string }) {
  return (
    <p className="mono text-[11px] text-(--color-accent) mt-8" data-testid="microsites-error">
      {message}
    </p>
  );
}

function EmptyState() {
  const t = useTranslations('adminPages.microsites');
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

function MicrositesTable({ rows }: { rows: readonly MicrositeSummary[] }) {
  return (
    <div data-testid="microsites-list" className="border border-(--color-rule) rounded-[3px] overflow-hidden">
      <table className="w-full border-collapse">
        <TableHead />
        <tbody>
          {rows.map((p) => <PageRow key={p.id} page={p} />)}
        </tbody>
      </table>
    </div>
  );
}

function TableHead() {
  const t = useTranslations('adminPages.microsites.columns');
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

// PageRow — one row per page. No inline preview (that put every page's full render in the list at
// once); the title and the "edit" action both link to the page's own editor route /admin/edit/<slug>.
function PageRow({ page }: { page: MicrositeSummary }) {
  return (
    <tr data-testid={`microsite-row-${page.slug}`} className="border-b border-(--color-rule)/60">
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
function BindingCell({ page }: { page: MicrositeSummary }) {
  return (
    <td className="px-4 py-3 mono text-[10px]" data-testid={`microsite-codes-${page.slug}`}>
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
  const t = useTranslations('adminPages.microsites');
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
function ByoaiToggle({ page }: { page: MicrositeSummary }) {
  const bound = (page.bound_codes ?? []).length > 0;
  return bound ? <ByoaiVoid slug={page.slug} /> : <ByoaiButton page={page} />;
}

function ByoaiVoid({ slug }: { slug: string }) {
  const t = useTranslations('adminPages.microsites');
  return (
    <div className="text-(--color-faint) mt-1" data-testid={`microsite-byoai-void-${slug}`}>
      {t('byoaiVoid')}
    </div>
  );
}

// block —— the previous version was an inline `<button>`, so it sat right after
// "which codes unlock this page", reading on screen as
// `…anonymous onlyno bring-your-own-key`: two sentences glued into one nobody could
// parse (UX-98).
function ByoaiButton({ page }: { page: MicrositeSummary }) {
  const t = useTranslations('adminPages.microsites');
  const { setByoai } = useMicrosites();
  const run = useAction();
  const allow = page.allow_byoai ?? false;
  return (
    <button
      type="button"
      className="block mono text-[10px] mt-1 text-(--color-accent) hover:underline"
      data-testid={`microsite-byoai-${page.slug}`}
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
  const t = useTranslations('adminPages.microsites.visibilityState');
  const view = buildView(hasLive, hasStaging);
  return (
    <td className={`px-4 py-3 mono text-[10px] tracking-[0.12em] uppercase ${view.tone}`}>
      {t(view.key)}
    </td>
  );
}

function PageCell({ page }: { page: MicrositeSummary }) {
  const t = useTranslations('adminPages.microsites');
  return (
    <td className="px-4 py-3">
      <Link
        href={`/admin/edit/${page.slug}`}
        className="block hover:opacity-70"
      >
        <span data-testid={`microsite-open-${page.slug}`} className="font-serif text-[16px] text-(--color-ink)">{page.title}</span>
        <HomepageBadge slug={page.slug} />
        <span className="block mono text-[10px] text-(--color-faint) mt-0.5">
          {t('slugPath', { slug: page.slug })}
        </span>
      </Link>
    </td>
  );
}

// HomepageBadge — marks the reserved `home` page, the one served at `/` (owner: "标注这个是
// homepage"). Only that one row carries it.
function HomepageBadge({ slug }: { slug: string }) {
  const t = useTranslations('adminPages.microsites');
  return slug === HOMEPAGE_SLUG ? (
    <span
      data-testid="microsite-homepage-badge"
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
function ActionsCell({ page }: { page: MicrositeSummary }) {
  return (
    <td className="px-4 py-3 text-right whitespace-nowrap">
      <EditLink slug={page.slug} />
      <ViewLiveLink page={page} />
      <TakeDownLink page={page} />
      <DeleteLink slug={page.slug} />
    </td>
  );
}

// EditLink — the discoverable "edit" affordance: a link to the page's own editor route. Without it
// the owner saw only view/take-down/delete and couldn't tell how to edit ("看不见按键").
function EditLink({ slug }: { slug: string }) {
  const t = useTranslations('adminPages.microsites');
  return (
    <Link
      href={`/admin/edit/${slug}`}
      className="mono text-[10.5px] tracking-[0.14em] uppercase text-(--color-accent) hover:underline"
    >
      <span data-testid={`microsite-edit-${slug}`}>{t('edit')}</span>
    </Link>
  );
}

// TakeDownLink —— take the page down. The build is kept and can go live again any
// time, so this is a separate action from "delete" — actions with different
// consequences don't get merged. Not shown for a page that isn't live — something
// that can't be un-taken-down shouldn't offer a take-down entry point.
function TakeDownLink({ page }: { page: MicrositeSummary }) {
  const t = useTranslations('adminPages.microsites');
  const { rollback } = useMicrosites();
  const run = useAction();
  return page.has_live ? (
    <button
      type="button"
      data-testid={`microsite-takedown-${page.slug}`}
      className="ml-3 mono text-[10.5px] tracking-[0.14em] uppercase text-(--color-muted) hover:text-(--color-ink)"
      onClick={() => void run(() => rollback(page.slug), { success: t('tookDown', { slug: page.slug }) })}
    >
      {t('takeDown')}
    </button>
  ) : null;
}

function DeleteLink({ slug }: { slug: string }) {
  const t = useTranslations('adminPages.microsites');
  const { removePage } = useMicrosites();
  const run = useAction();
  return (
    <button
      type="button"
      data-testid={`microsite-delete-${slug}`}
      className="ml-3 mono text-[10.5px] tracking-[0.14em] uppercase text-(--color-muted) hover:text-(--color-accent)"
      onClick={() => void run(() => removePage(slug), { success: t('deleted', { slug }) })}
    >
      {t('delete')}
    </button>
  );
}

function ViewLiveLink({ page }: { page: MicrositeSummary }) {
  const t = useTranslations('adminPages.microsites');
  // A plain <a>, not next/link: /p/<slug> is the vite-built page served by the backend, not a
  // route in this Next app. next/link tries a soft client navigation, finds no matching app
  // route, and never hard-navigates — the link looks clicked but the page never changes. A raw
  // anchor does the real cross-boundary navigation.
  return page.has_live ? (
    <a
      href={`/p/${page.slug}`}
      className="ml-3 mono text-[10.5px] tracking-[0.14em] uppercase text-(--color-accent) hover:underline"
    >
      {t('viewLive')} ↗
    </a>
  ) : (
    <span className="ml-3 mono text-[10.5px] tracking-[0.14em] uppercase text-(--color-faint)">
      {t('noLiveBuild')}
    </span>
  );
}

// The TEMPLATES AVAILABLE block was removed: the four cards `press-kit / list-prose /
// menu / auto-now` were **pure i18n copy** — no template artifact exists anywhere in
// the repo, and `microsite.create` doesn't even accept a template parameter.
// Displaying four things the owner can't actually get is worse than showing nothing
// ([[names-that-lie]]). Once a real template exists, hook it back up.

