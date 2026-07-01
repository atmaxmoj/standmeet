// RequestsSection —— /admin/requests。visitor 在 /<handle>/gate 留的 note
// 落进来；owner 按 open / replied / closed filter 过 + 标状态。

'use client';

import { useState } from 'react';

import { SectionHeader } from '@/components/admin/SectionHeader';
import { Btn } from '@/components/admin/atoms/Btn';
import { Chip } from '@/components/admin/atoms/Chip';
import { ListSkeleton } from '@/components/skeletons/ListSkeleton';
import type { AccessRequestView } from '@/lib/api/admin';
import {
  pickBodyState,
  useRequests,
  type ApproveOutcome,
  type RequestStatusFilter,
  type RequestsHook,
} from '@/lib/admin/use-requests';
import { useMail } from '@/lib/admin/use-mail';
import { useAction } from '@/lib/ui/use-action';

const FILTERS: RequestStatusFilter[] = ['open', 'replied', 'closed', 'all'];

export function RequestsSection() {
  const hook = useRequests();
  const mail = useMail();
  const mailConnected = mail.status?.connected ?? false;
  return (
    <>
      <SectionHeader
        kicker="access · gate inbox"
        title="requests"
        count={requestCount(hook)}
      />
      <Intro />
      <MailHint mailConnected={mailConnected} />
      <FilterRow hook={hook} />
      <RequestBody hook={hook} mailConnected={mailConnected} />
    </>
  );
}

function MailHint({ mailConnected }: { mailConnected: boolean }) {
  return mailConnected ? null : (
    <p
      className="mono text-[11.5px] text-(--color-accent) mb-5"
      data-testid="requests-mail-hint"
    >
      No verified mail connector — configure and test SMTP under Connectors to issue + email
      access codes. Until then you can only mark requests replied/closed by hand.
    </p>
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

function RequestBody({ hook, mailConnected }: { hook: RequestsHook; mailConnected: boolean }) {
  const map = {
    loading: <ListSkeleton count={4} />,
    error: <ErrorBlock message={hook.error ?? ''} />,
    empty: <EmptyState filter={hook.filter} />,
    list: <RequestList hook={hook} mailConnected={mailConnected} />,
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

function RequestList({ hook, mailConnected }: { hook: RequestsHook; mailConnected: boolean }) {
  return (
    <ul className="space-y-5" data-testid="requests-list">
      {hook.rows.map((r) => (
        <li key={r.id} data-testid={`request-row-${r.id}`}>
          <RequestCard req={r} hook={hook} mailConnected={mailConnected} />
        </li>
      ))}
    </ul>
  );
}

function RequestCard({
  req, hook, mailConnected,
}: { req: AccessRequestView; hook: RequestsHook; mailConnected: boolean }) {
  const [outcome, setOutcome] = useState<ApproveOutcome | null>(null);
  return (
    <article className="border border-(--color-rule) p-5 rounded-sm bg-(--color-surface)/30">
      <RequestHead req={req} />
      <blockquote className="font-serif italic text-(--color-ink) text-[16px] border-l-2 border-(--color-rule) pl-4 mt-3 mb-0">
        &ldquo;{req.message}&rdquo;
      </blockquote>
      <RequestActions
        req={req} hook={hook} mailConnected={mailConnected} onApproved={setOutcome}
      />
      <ApproveOutcomeView outcome={outcome} />
    </article>
  );
}

function ApproveOutcomeView({ outcome }: { outcome: ApproveOutcome | null }) {
  return outcome === null
    ? null
    : <ApproveOutcomeLine outcome={outcome} />;
}

function ApproveOutcomeLine({ outcome }: { outcome: ApproveOutcome }) {
  return outcome.ok
    ? (
      <p className="mono text-[11.5px] text-(--color-accent) mt-3" data-testid="approve-issued-code">
        issued {outcome.code} — emailed to the requester
      </p>
    )
    : (
      <p className="mono text-[11.5px] text-(--color-accent) mt-3" data-testid="approve-error">
        {outcome.error}
      </p>
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

interface ActionsProps {
  req: AccessRequestView;
  hook: RequestsHook;
  mailConnected: boolean;
  onApproved: (o: ApproveOutcome) => void;
}

function RequestActions(props: ActionsProps) {
  const closed = props.req.status === 'closed';
  return closed ? null : <ActiveActions {...props} />;
}

function ActiveActions({ req, hook, mailConnected, onApproved }: ActionsProps) {
  const run = useAction();
  // decline 是状态变更 → 成功/失败都用 toast 收尾（失败不再静默：没标上 owner 必须知道）。
  const onDecline = () => run(() => hook.mark(req.id, 'closed'), { success: 'Request declined' });
  return (
    <div className="flex items-baseline gap-2 mt-4 flex-wrap" data-testid={`request-approve-${req.id}`}>
      <ApproveControl id={req.id} hook={hook} mailConnected={mailConnected} onApproved={onApproved} />
      <Btn kind="outline" size="sm" onClick={() => { void onDecline(); }}>
        decline
      </Btn>
    </div>
  );
}

function ApproveControl({
  id, hook, mailConnected, onApproved,
}: { id: string; hook: RequestsHook; mailConnected: boolean; onApproved: (o: ApproveOutcome) => void }) {
  return mailConnected
    ? (
      <Btn
        kind="primary" size="sm"
        onClick={() => { void runApprove(hook, id, onApproved); }}
      >
        approve · issue + email code →
      </Btn>
    )
    : (
      <span className="mono text-[10.5px] tracking-[0.10em] uppercase text-(--color-faint)">
        connect mail to issue codes
      </span>
    );
}

async function runApprove(
  hook: RequestsHook, id: string, onApproved: (o: ApproveOutcome) => void,
): Promise<void> {
  onApproved(await hook.approve(id));
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().slice(0, 10);
}
