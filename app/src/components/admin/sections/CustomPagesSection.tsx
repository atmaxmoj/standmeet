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
      <ByoaiLine allow={page.allow_byoai ?? false} />
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

function ByoaiLine({ allow }: { allow: boolean }) {
  const t = useTranslations('adminPages.customPages');
  return (
    <div className="text-(--color-faint) mt-1">{allow ? t('byoaiOn') : t('byoaiOff')}</div>
  );
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

function ActionsCell({ page }: { page: CustomPageSummary }) {
  return (
    <td className="px-4 py-3 text-right">
      <ViewLiveLink page={page} />
    </td>
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

