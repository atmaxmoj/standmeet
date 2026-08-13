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
  pillToneFor,
  submissionLabel,
  type Application,
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
        kicker="jobs · committed"
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

// titleCount —— 数的是申请行,不是"已投出"的申请:今天没有任何代码会把一行标成投出去了,
// 所以 `N sent` 这句话在每一台实例上都是假的(F-E-3)。
function titleCount(n: number, loading: boolean): string {
  return loading ? 'loading…' : `${n} committed`;
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
    <div className="sm-empty">
      <p className="sm-empty-title">{t('applications.emptyTitle')}</p>
      <p className="sm-empty-hint reading">
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
    committedAt: row.created_at,
    submittedAt: realDate(row.submitted_at),
    method: 'autofill',
    contact: '—',
    notes: '',
    state: submissionLabel(row.status),
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
      <StatusPill id={row.id} wire={row.status} />
    </div>
  );
}

// RowMeta —— commit 那一刻是真的,投递那一刻今天还没有(没有代码写它)。
// 上一版把 `sent —` 排在第一位:一个断言"已投出"的标签配一个不存在的日期。
function RowMeta({ row }: { row: AdminApplicationRow }) {
  const t = useTranslations('adminJobs');
  return (
    <div className="mono text-[10px] tracking-[0.14em] uppercase text-(--color-muted) flex items-baseline gap-3 flex-wrap mt-2">
      <span>{t('applications.metaCommitted', { date: formatDate(row.created_at) })}</span>
      <span className="text-(--color-faint)">·</span>
      <SubmittedMeta iso={realDate(row.submitted_at)} />
    </div>
  );
}

function SubmittedMeta({ iso }: { iso: string }) {
  const t = useTranslations('adminJobs');
  return (
    <span>
      {iso === ''
        ? t('applications.metaNotSubmitted')
        : t('applications.metaSubmitted', { date: iso.slice(0, 10) })}
    </span>
  );
}

// realDate —— pg 的 NULL timestamptz 经 Go 的零值走过来是 "0001-01-01T…"。
// 那不是一个日期,是"没有";空串统一表示"没有"。
function realDate(iso: string): string {
  return iso === '' || iso.startsWith('0001') ? '' : iso;
}

function formatDate(iso: string): string {
  return realDate(iso) === '' ? '—' : iso.slice(0, 10);
}

function StatusPill({ id, wire }: { id: string; wire: string }) {
  return (
    <span className={`sm-pill ${pillToneFor(wire)}`} data-testid={`application-state-${id}`}>
      <span className="sm-dot-mark" />
      {submissionLabel(wire)}
    </span>
  );
}
