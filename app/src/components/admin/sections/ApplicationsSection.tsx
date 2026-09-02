// ApplicationsSection —— /admin/applications.
//
// Data comes from a real GET /api/admin/applications fetch; the detail modal still
// runs on the mock applications-model (ApplicationDetailModal currently expects
// timeline / notes / snapshot jsonb fields that aren't on the row — waiting on a
// single-record detail endpoint).

'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { SectionHeader } from '@/components/admin/SectionHeader';
import { ApplicationDetailModal } from '@/components/admin/ApplicationDetailModal';
import { toDraftModel } from '@/lib/admin/draft-detail';
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
        slug="applications"
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

// titleCount —— counts application rows, not "sent" applications: no code today
// marks a row as sent, so the phrase `N sent` would be false on every instance (F-E-3).
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

// toDetailApp —— assembles a detail from the real list row (the notes / contact jsonb
// fields aren't out of the backend yet, so leave them empty — don't fabricate data).
// **The resume content is real**: it's right there on the row (F-E-23).
function toDetailApp(row: AdminApplicationRow): Application {
  return {
    id: row.id,
    company: row.company,
    role: row.role,
    committedAt: row.created_at,
    submittedAt: realDate(row.submitted_at),
    method: 'autofill',
    // Both left as **empty strings** — "absent" is stated once by the render layer
    // (`EmptyMark`), not faked as a dash in the model. Contact used to hardcode `—`
    // here while notes used `notes || '—'` in the view: the same "absent" was said
    // in two layers, in two different fonts — on screen that read as a short dash
    // and a long dash side by side (UX-89).
    contact: '',
    notes: '',
    state: submissionLabel(row.status),
    resumeContent: toDraftModel({
      id: row.id, company: row.company, role: row.role,
      resume_content: row.resume_content,
    }),
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

// ValueCell —— one "label + value" cell. **The empty state is stated by this cell
// itself, and both cells state it identically** (UX-89).
//
// Contact used to hardcode a `—` as data in the model while notes used
// `notes || '—'` in the view — the same "absent" was split across two layers, and
// the two cells used different fonts (mono 11px vs. serif 12px), so the two dashes
// sat side by side at different lengths. Unifying the dash character to mono alone
// isn't enough: inline font size can be unified, but **baseline can't** — a line
// box's baseline position is set by the parent font's metrics, and Newsreader and
// JetBrains Mono don't land on the same line. So when empty, **the whole cell**
// switches to mono; when it has a value, each field uses its proper font (contact
// is data, notes is prose).
function ValueCell({ label, value, full }: { label: string; value: string; full: string }) {
  const empty = value === '';
  return (
    <div className="min-w-0">
      <div className="mono text-[9.5px] tracking-[0.14em] uppercase text-(--color-faint) mb-0.5">
        {label}
      </div>
      <div className={`${empty ? 'mono text-[11px] text-(--color-faint)' : `${full} text-(--color-muted)`} truncate`}>
        {empty ? '—' : value}
      </div>
    </div>
  );
}

function AppCardFooter({ contact, notes, onOpen }: { contact: string; notes: string; onOpen: () => void }) {
  const t = useTranslations('adminJobs');
  return (
    <div className="grid grid-cols-3 gap-3 px-4 py-3 border-t border-(--color-rule)/60">
      <ValueCell label={t('applications.contact')} value={contact} full="mono text-[11px]" />
      <ValueCell label={t('applications.notes')} value={notes} full="reading text-[12px]" />
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

// RowMeta —— the commit moment is real; the submit moment doesn't exist yet today
// (no code writes it). The previous version put `sent —` first: a label asserting
// "sent" paired with a date that doesn't exist.
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

// realDate —— a NULL timestamptz in pg arrives via Go's zero value as "0001-01-01T…".
// That isn't a date, it's "absent"; an empty string uniformly means "absent".
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
