// RequestsSection —— /admin/requests。visitor 在 /<handle>/gate 留的 note
// 落进来；owner 按 open / replied / closed filter 过 + 标状态。

'use client';

import { SectionHeader } from '../SectionHeader';
import { Btn } from '../atoms/Btn';
import { Chip } from '../atoms/Chip';
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
        kicker="surface · gate"
        title="access requests"
        count={hook.loading ? 'loading…' : `${hook.rows.length} requests`}
      />
      <FilterRow hook={hook} />
      <RequestBody hook={hook} />
    </>
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
    loading: <Loading />,
    error: <ErrorBlock message={hook.error ?? ''} />,
    empty: <EmptyState filter={hook.filter} />,
    list: <RequestList hook={hook} />,
  } as const;
  return map[pickBodyState(hook)];
}

function Loading() {
  return <p className="reading-tight italic text-(--color-muted) mt-8">loading…</p>;
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
      <p className="reading text-(--color-ink) mt-3" style={{ fontSize: '15.5px' }}>
        {req.message}
      </p>
      <RequestActions req={req} onMark={onMark} />
    </article>
  );
}

function RequestHead({ req }: { req: AccessRequestView }) {
  return (
    <div className="flex items-baseline justify-between gap-4 flex-wrap">
      <div>
        <div className="font-serif text-(--color-ink)" style={{ fontSize: '18px', fontWeight: 500 }}>
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
      <Btn kind="ghost" size="sm" onClick={() => { void onMark(req.id, 'replied'); }} testid={`request-mark-replied-${req.id}`}>
        mark replied
      </Btn>
      <Btn kind="ghost" size="sm" onClick={() => { void onMark(req.id, 'closed'); }} testid={`request-mark-closed-${req.id}`}>
        close
      </Btn>
    </div>
  ) : null;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().slice(0, 10);
}
