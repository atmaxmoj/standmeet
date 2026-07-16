// CustomPagesSection —— /admin/custom-pages。owner 通过 MCP 创建的 React
// 子页 + 状态 + "view live ↗" 链接。
//
// 设计源 docs/design/project/admin.js PagesSection (514-571)：intro
// paragraph + 表格 (page · template · visibility · updated · actions) +
// "templates available" 4-cell grid。模板字段 schema 还没有，先静态展示
// 可选模板让 owner 知道下一步用哪种。
//
// 写操作 (create/build/promote) 不在 admin —— owner 在 Claude 通过 MCP
// driver 调；admin 这里只 confirm 状态。

'use client';

import Link from 'next/link';

import { SectionHeader } from '@/components/admin/SectionHeader';
import { ListSkeleton } from '@/components/skeletons/ListSkeleton';
import {
  pickCustomPagesBodyState,
  useCustomPages,
  type CustomPagesHook,
  type CustomPageSummary,
} from '@/lib/admin/use-custom-pages';

export function CustomPagesSection() {
  const hook = useCustomPages();
  return (
    <>
      <SectionHeader
        kicker="corpus · public-facing"
        title="pages"
        count={hook.status === 'ready' ? String(hook.rows.length) : ''}
      />
      <Intro />
      <CustomPagesBody hook={hook} />
      <TemplatesBlock />
    </>
  );
}

function Intro() {
  return (
    <p className="reading text-[14.5px] text-(--color-muted) mb-6 max-w-[54em]">
      Custom pages live at <span className="mono text-(--color-ink)">/p/&lt;slug&gt;</span>.
      Each binds a template to data from your corpus and renders with the same chrome
      as the public site. Build via MCP — owner drives the lifecycle from Claude.
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
  return (
    <p className="reading-tight italic text-(--color-muted) mt-8">
      No custom pages yet. Owner creates / builds / promotes via MCP{' '}
      (<span className="mono">custom_page.create</span>,{' '}
      <span className="mono">.write_file</span>,{' '}
      <span className="mono">.build</span>,{' '}
      <span className="mono">.promote_to_live</span>).
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
  return (
    <thead className="bg-(--color-surface)/60 mono text-[9.5px] tracking-[0.16em] uppercase text-(--color-muted)">
      <tr>
        <th className="text-left px-4 py-2.5 border-b border-(--color-rule) font-normal">page</th>
        <th className="text-left px-4 py-2.5 border-b border-(--color-rule) font-normal">template</th>
        <th className="text-left px-4 py-2.5 border-b border-(--color-rule) font-normal">visibility</th>
        <th className="text-left px-4 py-2.5 border-b border-(--color-rule) font-normal">views</th>
        <th className="text-left px-4 py-2.5 border-b border-(--color-rule) font-normal">updated</th>
        <th className="text-right px-4 py-2.5 border-b border-(--color-rule) font-normal">actions</th>
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
      <ViewsCell />
      <DateCell iso={page.updated_at} />
      <ActionsCell page={page} />
    </tr>
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
  const view = buildView(hasLive, hasStaging);
  return (
    <td className={`px-4 py-3 mono text-[10px] tracking-[0.12em] uppercase ${view.tone}`}>
      {view.label}
    </td>
  );
}

function ViewsCell() {
  return (
    <td className="px-4 py-3 mono text-[10px] text-(--color-faint)">
      —
    </td>
  );
}

function PageCell({ page }: { page: CustomPageSummary }) {
  return (
    <td className="px-4 py-3">
      <div className="font-serif text-[16px] text-(--color-ink)">{page.title}</div>
      <div className="mono text-[10px] text-(--color-faint) mt-0.5">/p/{page.slug}</div>
    </td>
  );
}


function buildView(hasLive: boolean, hasStaging: boolean): { label: string; tone: string } {
  const key = hasLive ? 'live' : (hasStaging ? 'staging' : 'none');
  return BUILD_VIEW_MAP[key];
}

const BUILD_VIEW_MAP = {
  live: { label: 'live', tone: 'text-(--color-ink)' },
  staging: { label: 'staging', tone: 'text-(--color-amber)' },
  none: { label: 'none', tone: 'text-(--color-faint)' },
} as const;

function DateCell({ iso }: { iso: string }) {
  return (
    <td className="px-4 py-3 mono text-[10px] text-(--color-muted)">
      {formatDate(iso)}
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
  return page.has_live ? (
    <Link
      href={`/p/${page.slug}`}
      className="mono text-[10.5px] tracking-[0.14em] uppercase text-(--color-accent) hover:underline"
    >
      view live ↗
    </Link>
  ) : (
    <span className="mono text-[10.5px] tracking-[0.14em] uppercase text-(--color-faint)">
      no live build
    </span>
  );
}

const TEMPLATES = [
  { id: 'press-kit', label: 'press-kit', desc: 'photo · bio variants · downloads' },
  { id: 'list-prose', label: 'list-with-prose', desc: 'list above, prose explanation below' },
  { id: 'menu', label: 'menu', desc: 'numbered service / offer rows' },
  { id: 'auto-now', label: 'auto-now', desc: 'AI-summarized latest entries · /now' },
] as const;

function TemplatesBlock() {
  return (
    <div className="mt-6 border border-(--color-rule) rounded-[3px] bg-(--color-surface)/30 p-4">
      <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-2">
        templates available
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {TEMPLATES.map((t) => <TemplateCard key={t.id} label={t.label} desc={t.desc} />)}
      </div>
    </div>
  );
}

function TemplateCard({ label, desc }: { label: string; desc: string }) {
  return (
    <div className="border border-(--color-rule) p-3 rounded-[3px]">
      <div className="mono text-[11px] text-(--color-ink) tracking-[0.04em]">{label}</div>
      <div className="reading text-[12.5px] text-(--color-muted) mt-1">{desc}</div>
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().slice(0, 10);
}
