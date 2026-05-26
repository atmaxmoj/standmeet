// CustomPagesSection —— /admin/custom-pages。列 owner 通过 MCP 创建的 React
// 子页 + 状态 + "view live ↗" 链接。
//
// 只读视图：admin 不暴露 create/build/promote 等写操作（owner 在 Claude
// 那侧通过 MCP tool 驱动；admin 这里只 confirm 状态）。"view live ↗" 在
// has_live=true 时可点，跳到 /p/<slug>（middleware 反代给 backend
// /api/v1/custom-pages/<slug>/* 出渲染好的 React 静态产物）。

'use client';

import Link from 'next/link';

import { SectionHeader } from '@/components/admin/SectionHeader';
import { Pill } from '@/components/admin/atoms/Pill';
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
      <CustomPagesBody hook={hook} />
    </>
  );
}

function CustomPagesBody({ hook }: { hook: CustomPagesHook }) {
  const map = {
    loading: <ListSkeleton count={3} />,
    error: <ErrorBlock message={hook.error ?? ''} />,
    empty: <EmptyState />,
    list: <CustomPagesList rows={hook.rows} />,
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

function CustomPagesList({ rows }: { rows: readonly CustomPageSummary[] }) {
  return (
    <ul className="space-y-4" data-testid="custom-pages-list">
      {rows.map((p) => (
        <li key={p.id} data-testid={`custom-page-row-${p.slug}`}>
          <CustomPageCard page={p} />
        </li>
      ))}
    </ul>
  );
}

function CustomPageCard({ page }: { page: CustomPageSummary }) {
  return (
    <article className="border border-(--color-rule) p-5 rounded-sm bg-(--color-surface)/30">
      <CustomPageHead page={page} />
      <CustomPageMeta page={page} />
    </article>
  );
}

function CustomPageHead({ page }: { page: CustomPageSummary }) {
  return (
    <div className="flex items-baseline justify-between gap-4 flex-wrap">
      <h3 className="font-serif text-(--color-ink) text-[18px] font-medium">
        {page.title}
      </h3>
      <ViewLiveLink page={page} />
    </div>
  );
}

// ViewLiveLink —— has_live 时返可点链接（href 直接到 /p/<slug>），否则
// 灰色 "no live build" 文字提示。spec 通过 role=link + name 定位。
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

function CustomPageMeta({ page }: { page: CustomPageSummary }) {
  return (
    <div className="mt-3 flex items-baseline gap-3 flex-wrap mono text-[10px] tracking-[0.08em] text-(--color-muted)">
      <span className="text-(--color-faint)">slug</span>
      <code className="text-(--color-ink)">{page.slug}</code>
      <span className="text-(--color-faint)">·</span>
      <Pill tone={page.status === 'active' ? 'accent' : 'muted'}>{page.status}</Pill>
      <StagingPill hasStaging={page.has_staging} hasLive={page.has_live} />
      <span className="ml-auto text-(--color-faint)">{formatDate(page.updated_at)}</span>
    </div>
  );
}

function StagingPill({ hasStaging, hasLive }: { hasStaging: boolean; hasLive: boolean }) {
  return hasStaging && !hasLive ? <Pill tone="muted">staging only</Pill> : null;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().slice(0, 10);
}
