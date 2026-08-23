// CustomPagesSection —— /admin/custom-pages。owner 通过 MCP 创建的 React
// 子页 + 状态 + "view live ↗" 链接。
//
// 设计源 docs/design/project/admin.js PagesSection：intro
// paragraph + 表格 (page · template · visibility · updated · actions) +
// "templates available" 4-cell grid。模板字段 schema 还没有，先静态展示
// 可选模板让 owner 知道下一步用哪种。
//
// 写操作 (create/build/promote) 不在 admin —— owner 在 Claude 通过 MCP
// driver 调；admin 这里只 confirm 状态。

'use client';

import { useTranslations } from 'next-intl';
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
        kicker="corpus · microsites"
        slug="custom-pages"
        count={hook.status === 'ready' ? String(hook.rows.length) : ''}
      />
      <Intro />
      <CustomPagesBody hook={hook} />
      <AuthoringPanel />
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
          {rows.map((p) => <PageRow key={p.id} page={p} />)}
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

function PageRow({ page }: { page: CustomPageSummary }) {
  return (
    <tr data-testid={`custom-page-row-${page.slug}`} className="border-b border-(--color-rule)/60 last:border-b-0">
      <PageCell page={page} />
      <TemplateCell />
      <VisibilityCell hasLive={page.has_live} hasStaging={page.has_staging} />
      <BindingCell page={page} />
      <DateCell iso={page.updated_at} />
      <ActionsCell page={page} />
    </tr>
  );
}

// BindingCell —— 哪些码开这一页。**绑定的另一头**：码那一侧看得到页，这一侧看得到码。
// 只能单向看见的绑定，人会忘了自己建过。
function BindingCell({ page }: { page: CustomPageSummary }) {
  return (
    <td className="px-4 py-3 mono text-[10px]" data-testid={`custom-page-codes-${page.slug}`}>
      <BoundCodes codes={page.bound_codes ?? []} />
      <ByoaiToggle page={page} />
    </td>
  );
}

// BoundCodes —— 哪些码开这一页。
//
// 这里的「空」跟列表空态不是一回事：行已经加载好了，`bound_codes` 是它上面的一个字段，
// 空就是**真的没有码指向它**，不存在「加载失败看起来也像空」那种歧义
// （check-one-empty-state 防的是后者）。
function BoundCodes({ codes }: { codes: readonly string[] }) {
  const t = useTranslations('adminPages.customPages');
  const bound = codes.join(' · ');
  return bound !== ''
    ? <span className="text-(--color-ink)">{t('boundCodes')} {bound}</span>
    : <span className="text-(--color-faint)">{t('boundNone')}</span>;
}

// ByoaiToggle —— 这一页允不允许访客自带 key。
//
// **挂了码就作废**：码决定准入，页自己那一格不再说了算（"pages 给了 code 一个渲染"）。
// 所以挂了码时不是把控件藏起来，而是明说它被顶掉了 —— 藏起来的话，owner 会以为
// 自己上次设的还算数。
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

// block —— 上一版是行内 `<button>`，于是它紧接在「哪些码开这一页」那句后面，
// 屏幕上读成 `…anonymous onlyno bring-your-own-key`：两句话粘成一句谁也看不懂的话（UX-98）。
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

// ActionsCell —— 看、下线、删。**发得出去就得撤得回来**：少了后两个，
// 「owner 在 admin 撤了，访客就访问不到」这条规矩在这一屏上根本没法执行，
// owner 得开一个 Claude 会话调 MCP 才能把自己刚发的东西拿下来（F-P-4）。
function ActionsCell({ page }: { page: CustomPageSummary }) {
  return (
    <td className="px-4 py-3 text-right whitespace-nowrap">
      <ViewLiveLink page={page} />
      <TakeDownLink page={page} />
      <DeleteLink slug={page.slug} />
    </td>
  );
}

// TakeDownLink —— 下线。构建还在，随时可以再上线，所以它跟「删掉」是两个动作，
// 后果不一样就不合成一个。没在服务的页面不显示这个 —— 一个撤不下来的东西不该有撤的入口。
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

// TEMPLATES AVAILABLE 那一块删了：`press-kit / list-prose / menu / auto-now` 四张卡是
// **纯 i18n 文案** —— 仓库里没有任何模板产物，`custom_page.create` 也不收 template 参数。
// 面上摆着四个 owner 拿不到的东西，比什么都不摆更糟（[[names-that-lie]]）。
// 真模板做出来一个，再把它挂回来。

