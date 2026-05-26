// RequestsSection —— /admin/requests。visitor 在 /<handle>/gate 留的 note
// 落进来；owner 按 open / replied / closed filter 过 + 标状态。

'use client';

import { SectionHeader } from '@/components/admin/SectionHeader';
import { Btn } from '@/components/admin/atoms/Btn';
import { Chip } from '@/components/admin/atoms/Chip';
import { ListSkeleton } from '@/components/skeletons/ListSkeleton';
import type { AccessRequestView } from '@/lib/api/admin';
import {
  pickBodyState,
  useRequests,
  type RequestStatusFilter,
  type RequestsHook,
} from '@/lib/admin/use-requests';

const FILTERS: RequestStatusFilter[] = ['open', 'replied', 'closed', 'all'];

export function RequestsSection() {
  const hook = useRequests();
  return (
    <>
      <SectionHeader
        kicker="access · gate inbox"
        title="requests"
        count={requestCount(hook)}
      />
      <Intro />
      <FilterRow hook={hook} />
      <RequestBody hook={hook} />
    </>
  );
}

function Intro() {
  return (
    <p className="reading text-(--color-muted) mb-5 text-[14.5px] max-w-[54em]">
      Submissions from the gate&apos;s &ldquo;no code&rdquo; path. Mark replied
      once you&apos;ve issued a code or written back; close to archive. Owner
      reads every one personally — that&apos;s the point.
    </p>
  );
}

function FilterRow({ hook }: { hook: RequestsHook }) {
  return (
    <div className="flex items-baseline gap-2 mb-6 flex-wrap" data-testid="requests-filters">
      {FILTERS.map((f) => (
        <Chip key={f} active={hook.filter === f} onClick={() => hook.setFilter(f)}>
          {f}
        </Chip>
      ))}
    </div>
  );
}

function RequestBody({ hook }: { hook: RequestsHook }) {
  const map = {
    loading: <ListSkeleton count={4} />,
    error: <ErrorBlock message={hook.error ?? ''} />,
    empty: <EmptyState filter={hook.filter} />,
    list: <RequestList hook={hook} />,
  } as const;
  return map[pickBodyState(hook)];
}

function requestCount(hook: RequestsHook): string {
  return hook.status === 'ready'
    ? formatRequestCount(countOpen(hook.rows), hook.rows.length)
    : '';
}

function countOpen(rows: readonly AccessRequestView[]): number {
  return rows.filter((r) => r.status === 'open').length;
}

function formatRequestCount(open: number, total: number): string {
  return open === 0 ? `${total} total` : `${open} new`;
}

function ErrorBlock({ message }: { message: string }) {
  return (
    <p className="mono text-[11px] text-(--color-accent) mt-8" data-testid="requests-error">
      {message}
    </p>
  );
}

function EmptyState({ filter }: { filter: RequestStatusFilter }) {
  return (
    <p className="reading-tight italic text-(--color-muted) mt-8">
      No {filter === 'all' ? '' : `${filter} `}requests.
    </p>
  );
}

function RequestList({ hook }: { hook: RequestsHook }) {
  return (
    <ul className="space-y-5" data-testid="requests-list">
      {hook.rows.map((r) => (
        <li key={r.id} data-testid={`request-row-${r.id}`}>
          <RequestCard req={r} onMark={hook.mark} />
        </li>
      ))}
    </ul>
  );
}

function RequestCard({
  req, onMark,
}: { req: AccessRequestView; onMark: (id: string, s: 'replied' | 'closed') => Promise<void> }) {
  return (
    <article className="border border-(--color-rule) p-5 rounded-sm bg-(--color-surface)/30">
      <RequestHead req={req} />
      <blockquote className="font-serif italic text-(--color-ink) text-[16px] border-l-2 border-(--color-rule) pl-4 mt-3 mb-0">
        &ldquo;{req.message}&rdquo;
      </blockquote>
      <RequestActions req={req} onMark={onMark} />
    </article>
  );
}

function RequestHead({ req }: { req: AccessRequestView }) {
  return (
    <div className="flex items-baseline justify-between gap-4 flex-wrap">
      <div>
        <div className="font-serif text-(--color-ink) text-[18px] font-medium">
          {req.name}
          {req.org !== '' && (
            <span className="mono text-(--color-muted) text-[12px] ml-2">@ {req.org}</span>
          )}
        </div>
        <a
          href={`mailto:${req.email}`}
          className="mono text-[11px] tracking-[0.04em] text-(--color-accent) border-b border-(--color-accent)/40 hover:border-(--color-accent)"
        >
          {req.email}
        </a>
      </div>
      <div className="mono text-[10px] tracking-[0.12em] uppercase text-(--color-faint)">
        {req.status} · {formatDate(req.created_at)}
      </div>
    </div>
  );
}

function RequestActions({
  req, onMark,
}: { req: AccessRequestView; onMark: (id: string, s: 'replied' | 'closed') => Promise<void> }) {
  return req.status === 'open' ? (
    <div className="flex items-baseline gap-2 mt-4">
      <Btn kind="ghost" size="sm" onClick={() => { void onMark(req.id, 'replied'); }}>
        mark replied
      </Btn>
      <Btn kind="ghost" size="sm" onClick={() => { void onMark(req.id, 'closed'); }}>
        close
      </Btn>
    </div>
  ) : null;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().slice(0, 10);
}
