// ApplicationsSection —— /admin/applications。
//
// 数据走 GET /api/admin/applications 真 fetch；详情 modal 仍走 mock
// applications-model（modal 当前 ApplicationDetailModal 期待 timeline /
// notes / snapshot 等 jsonb 字段，row 上没有，等单条 detail endpoint）。

'use client';

import { useState } from 'react';

import { SectionHeader } from '@/components/admin/SectionHeader';
import { ApplicationDetailModal } from '@/components/admin/ApplicationDetailModal';
import {
  MOCK_APPLICATIONS,
  pillToneFor,
  type Application,
  type ApplicationStatus,
} from '@/lib/admin/applications-model';
import { listViewKind } from '@/lib/admin/list-view-kind';
import {
  useAdminApplications,
  type AdminApplicationRow,
} from '@/lib/admin/use-admin-applications';

export function ApplicationsSection() {
  const { rows, loading, error } = useAdminApplications();
  const [opened, setOpened] = useState<Application | null>(null);
  return (
    <>
      <SectionHeader
        kicker="jobs · sent"
        title="applications"
        count={titleCount(rows.length, loading)}
      />
      <Intro />
      <ListBody rows={rows} loading={loading} error={error} onOpen={setOpened} />
      {opened && (
        <ApplicationDetailModal app={opened} onClose={() => setOpened(null)} />
      )}
    </>
  );
}

function titleCount(n: number, loading: boolean): string {
  return loading ? 'loading…' : `${n} sent`;
}

function Intro() {
  return (
    <p className="reading-tight text-(--color-muted) mb-6 text-[15px] max-w-[54em]">
      Every committed application — frozen resume snapshot + auto-issued AccessCode.
      Recruiters scan the QR on the PDF and land directly in your chat. Click a card
      to review timeline + status + private notes.
    </p>
  );
}

function ListBody(props: {
  rows: readonly AdminApplicationRow[];
  loading: boolean;
  error: string | null;
  onOpen: (a: Application) => void;
}) {
  const kind = listViewKind(props.loading, props.error, props.rows.length);
  const map = {
    loading: <Loading />,
    error: <LoadError msg={props.error ?? ''} />,
    empty: <EmptyState />,
    list: <List rows={props.rows} onOpen={props.onOpen} />,
  } as const;
  return map[kind];
}

function Loading() {
  return (
    <p className="mono text-[11px] tracking-[0.14em] uppercase text-(--color-muted)">
      loading…
    </p>
  );
}

function LoadError({ msg }: { msg: string }) {
  return (
    <p
      className="mono text-[11px] tracking-[0.14em] uppercase text-(--color-accent)"
      data-testid="applications-error"
    >
      {msg}
    </p>
  );
}

function EmptyState() {
  return (
    <div className="p-6 border border-(--color-rule) rounded-[3px] bg-(--color-surface)/40 text-center">
      <p className="font-serif text-(--color-ink) text-[18px]">No applications sent yet.</p>
      <p className="reading text-(--color-muted) text-[14px] mt-1.5 max-w-[34em] mx-auto">
        Draft a resume from a shortlisted job listing, then send to commit it here.
      </p>
    </div>
  );
}

function List({
  rows, onOpen,
}: {
  rows: readonly AdminApplicationRow[];
  onOpen: (a: Application) => void;
}) {
  return (
    <div className="space-y-3" data-testid="applications-list">
      {rows.map((r) => (
        <Row key={r.id} row={r} onOpen={() => onOpen(toDetailApp(r))} />
      ))}
    </div>
  );
}

// toDetailApp —— list row 还没有 detail jsonb（notes / snapshot 等），
// 暂时用 MOCK_APPLICATIONS 同 id 找匹配；找不到 fallback 一个最小 mock。
// detail endpoint 落地后这层换 fetch by id。
function toDetailApp(row: AdminApplicationRow): Application {
  const mock = MOCK_APPLICATIONS.find((a) => a.id === row.id);
  return mock ?? {
    id: row.id,
    company: row.company,
    role: row.role,
    sentAt: row.submitted_at,
    method: 'autofill',
    contact: '—',
    notes: '',
    status: (row.status as ApplicationStatus | undefined) ?? 'silent',
    resumeDelta: '',
  };
}

function Row({
  row, onOpen,
}: { row: AdminApplicationRow; onOpen: () => void }) {
  return (
    <button
      type="button" onClick={onOpen}
      data-testid={`application-row-${row.id}`}
      className="w-full text-left border border-(--color-rule) rounded-[3px] p-4 hover:border-(--color-ink) transition-colors"
    >
      <RowHead row={row} />
      <RowMeta row={row} />
    </button>
  );
}

function RowHead({ row }: { row: AdminApplicationRow }) {
  return (
    <div className="flex items-baseline justify-between gap-4 flex-wrap">
      <div>
        <span className="font-serif text-[17px] text-(--color-ink) font-medium">
          {row.company}
        </span>
        <span className="font-serif italic text-[15px] text-(--color-muted) ml-2">
          · {row.role}
        </span>
      </div>
      <StatusPill status={(row.status as ApplicationStatus | undefined) ?? 'silent'} />
    </div>
  );
}

function RowMeta({ row }: { row: AdminApplicationRow }) {
  return (
    <div className="mono text-[10px] tracking-[0.14em] uppercase text-(--color-muted) flex items-baseline gap-3 flex-wrap mt-2">
      <span>sent {formatDate(row.submitted_at)}</span>
      <span className="text-(--color-faint)">·</span>
      <span>created {formatDate(row.created_at)}</span>
    </div>
  );
}

function formatDate(iso: string): string {
  return iso === '' || iso.startsWith('0001') ? '—' : iso.slice(0, 10);
}

function StatusPill({ status }: { status: ApplicationStatus }) {
  return (
    <span className={`sm-pill ${pillToneFor(status)}`}>
      <span className="sm-dot-mark" />
      {status}
    </span>
  );
}
