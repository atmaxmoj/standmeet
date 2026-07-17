// ApplicationsSection —— /admin/applications。
//
// 数据走 GET /api/admin/applications 真 fetch；详情 modal 仍走 mock
// applications-model（modal 当前 ApplicationDetailModal 期待 timeline /
// notes / snapshot 等 jsonb 字段，row 上没有，等单条 detail endpoint）。

'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { SectionHeader } from '@/components/admin/SectionHeader';
import { ApplicationDetailModal } from '@/components/admin/ApplicationDetailModal';
import {
  APPLICATION_STATUSES,
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
  const t = useTranslations('adminJobs');
  return (
    <p className="reading-tight text-(--color-muted) mb-6 text-[15px] max-w-[54em]">
      {t('applications.intro')}
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
  const t = useTranslations('adminJobs');
  return (
    <p className="mono text-[11px] tracking-[0.14em] uppercase text-(--color-muted)">
      {t('applications.loading')}
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
  const t = useTranslations('adminJobs');
  return (
    <div className="p-6 border border-(--color-rule) rounded-[3px] bg-(--color-surface)/40 text-center">
      <p className="font-serif text-(--color-ink) text-[18px]">{t('applications.emptyTitle')}</p>
      <p className="reading text-(--color-muted) text-[14px] mt-1.5 max-w-[34em] mx-auto">
        {t('applications.emptyHint')}
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

// toDetailApp —— 用真 list row 拼一个 detail（notes / snapshot / timeline 等
// jsonb 字段后端还没出,留空,不编假数据)。detail-by-id endpoint 落地后换真 fetch。
function toDetailApp(row: AdminApplicationRow): Application {
  return {
    id: row.id,
    company: row.company,
    role: row.role,
    sentAt: row.submitted_at,
    method: 'autofill',
    contact: '—',
    notes: '',
    status: parseAppStatus(row.status),
    resumeDelta: '',
  };
}

function Row({
  row, onOpen,
}: { row: AdminApplicationRow; onOpen: () => void }) {
  const detail = toDetailApp(row);
  return (
    <div
      data-testid={`application-row-${row.id}`}
      className="border border-(--color-rule) rounded-[3px] hover:border-(--color-ink) transition-colors"
    >
      <button
        type="button" onClick={onOpen}
        className="w-full text-left p-4"
      >
        <RowHead row={row} />
        <RowMeta row={row} />
      </button>
      <AppCardFooter contact={detail.contact} notes={detail.notes} onOpen={onOpen} />
    </div>
  );
}

function AppCardFooter({ contact, notes, onOpen }: { contact: string; notes: string; onOpen: () => void }) {
  const t = useTranslations('adminJobs');
  return (
    <div className="grid grid-cols-3 gap-3 px-4 py-3 border-t border-(--color-rule)/60">
      <div className="min-w-0">
        <div className="mono text-[9.5px] tracking-[0.14em] uppercase text-(--color-faint) mb-0.5">{t('applications.contact')}</div>
        <div className="mono text-[11px] text-(--color-muted) truncate">{contact}</div>
      </div>
      <div className="min-w-0">
        <div className="mono text-[9.5px] tracking-[0.14em] uppercase text-(--color-faint) mb-0.5">{t('applications.notes')}</div>
        <div className="reading text-[12px] text-(--color-muted) truncate">{notes || '—'}</div>
      </div>
      <div className="flex items-center justify-end">
        <button
          type="button" onClick={onOpen}
          className="mono text-[10px] tracking-[0.12em] uppercase text-(--color-accent) hover:underline"
        >
          {t('applications.open')}
        </button>
      </div>
    </div>
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
      <StatusPill status={parseAppStatus(row.status)} />
    </div>
  );
}

function RowMeta({ row }: { row: AdminApplicationRow }) {
  const t = useTranslations('adminJobs');
  return (
    <div className="mono text-[10px] tracking-[0.14em] uppercase text-(--color-muted) flex items-baseline gap-3 flex-wrap mt-2">
      <span>{t('applications.metaSent', { date: formatDate(row.submitted_at) })}</span>
      <span className="text-(--color-faint)">·</span>
      <span>{t('applications.metaCreated', { date: formatDate(row.created_at) })}</span>
    </div>
  );
}

function formatDate(iso: string): string {
  return iso === '' || iso.startsWith('0001') ? '—' : iso.slice(0, 10);
}

function parseAppStatus(s: string): ApplicationStatus {
  const found = APPLICATION_STATUSES.find((x) => x === s);
  return found ?? 'silent';
}

function StatusPill({ status }: { status: ApplicationStatus }) {
  return (
    <span className={`sm-pill ${pillToneFor(status)}`}>
      <span className="sm-dot-mark" />
      {status}
    </span>
  );
}
