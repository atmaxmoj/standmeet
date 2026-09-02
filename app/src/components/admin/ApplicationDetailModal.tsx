// ApplicationDetailModal —— the detail popup opened from a card on /admin/applications.
// Left col: timeline + contact + notes; right col: resume snapshot + status segmented.
//
// Design source: docs/design/project/admin.js ApplicationDetailModal.
// status is read-only display (rot-C1: no persistence path, writes only go through MCP
// applications.commit).

'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { ResumePage } from '@/components/admin/resume-page/ResumePage';
import {
  SUBMISSION_STATES,
  timelineFor,
  type Application,
  type TimelineEvent,
} from '@/lib/admin/applications-model';
import { draftToJobContext, draftToResumeContent } from '@/lib/admin/draft-model';

interface Props {
  app: Application;
  onClose: () => void;
}

// status is **read-only** (rot-C1): it reflects the real lifecycle of the backend application
// row, and this modal has no persistence path (/applications is GET-only, writes only go
// through MCP applications.commit). It used to be a clickable local-useState segmented control —
// looked editable and saved, but reverted on reload. That was the "looks saved but isn't" lie.
// Now it's read-only display.
export function ApplicationDetailModal({ app, onClose }: Props) {
  return (
    <div className="sm-app-modal-overlay sm-fadein" onClick={onClose}>
      <div
        className="sm-app-modal-card sm-rise"
        onClick={(e) => e.stopPropagation()}
        data-testid="application-detail-modal"
      >
        <ModalHeader app={app} onClose={onClose} />
        <ModalBody app={app} state={app.state} notes={app.notes} />
        <ModalFooter app={app} onClose={onClose} />
      </div>
    </div>
  );
}

function ModalHeader({ app, onClose }: { app: Application; onClose: () => void }) {
  const t = useTranslations('adminJobs');
  return (
    <div className="sm-app-modal-head">
      <div>
        <div className="sm-smallcaps">{t('detail.kicker', { id: app.id })}</div>
        <div className="sm-app-modal-title">
          {app.role} <span className="text-(--color-muted)">· {app.company}</span>
        </div>
      </div>
      <button
        type="button" onClick={onClose}
        className="sm-btn sm-btn-ghost"
        data-testid="application-detail-close"
      >
        {t('detail.close')}
      </button>
    </div>
  );
}

interface BodyProps {
  app: Application;
  state: string;
  notes: string;
}

function ModalBody(props: BodyProps) {
  return (
    <div className="sm-app-modal-body">
      <LeftCol app={props.app} notes={props.notes} />
      <RightCol app={props.app} state={props.state} />
    </div>
  );
}

function LeftCol({ app, notes }: { app: Application; notes: string }) {
  return (
    <div>
      <Timeline events={timelineFor(app)} />
      <ContactBlock contact={app.contact} />
      <NotesBlock notes={notes} />
    </div>
  );
}

function Timeline({ events }: { events: TimelineEvent[] }) {
  const t = useTranslations('adminJobs');
  return (
    <section>
      <div className="sm-smallcaps">{t('detail.timeline')}</div>
      <div className="sm-app-timeline">
        <div className="sm-app-timeline-rail" />
        {events.map((e, i) => <TimelineRow key={i} event={e} />)}
      </div>
    </section>
  );
}

function TimelineRow({ event }: { event: TimelineEvent }) {
  return (
    <div className="sm-app-timeline-row">
      <span className={`sm-app-timeline-dot is-${event.kind}`} />
      <div className="mono text-[9.5px] tracking-[0.06em] text-(--color-faint)">{event.t}</div>
      <div className={`font-serif text-[15px] mt-0.5 ${dotTextCls(event.kind)}`}>
        {event.label}
      </div>
    </div>
  );
}

function dotTextCls(kind: TimelineEvent['kind']): string {
  return kind === 'faint' ? 'text-(--color-faint)' : 'text-(--color-ink)';
}

function ContactBlock({ contact }: { contact: string }) {
  const t = useTranslations('adminJobs');
  return (
    <section className="mt-5 pt-3.5 border-t border-(--color-rule)">
      <div className="sm-smallcaps">{t('detail.contact')}</div>
      <div className="font-serif text-[15px] mt-1">{contact}</div>
      {/* Disabled: no contact and no channel to start a conversation from here (F-E-13).
          It used to be clickable and clicking it did nothing. */}
      <button type="button" disabled title={t('detail.needsWriter')} className="sm-btn sm-btn-outline sm-btn-sm mt-2">
        {t('detail.pingInChat')}
      </button>
    </section>
  );
}

// NotesBlock —— **read-only**, for the same reason as the status segmented control above:
// nothing in this chain persists notes.
//
// It used to be a plain editable multiline box: owner types a note, closes, reloads, and the
// text is gone — with no save button, no hint, and the backend never receiving a single write
// request (F-E-11). All three layers were empty: the frontend was pure useState, the list
// hardcoded notes to '', and the backend's whole jobs package had zero hits on `notes`.
//
// The design has a slot for this (`docs/design/job-loop.md` schema +
// `applications.update_status`), but that write path isn't built yet. **Until it exists, this
// field must not look like something that saves.** The day it's built, drop readOnly and wire
// the write path — this comment and its guard will remind us both pieces are needed.
function NotesBlock({ notes }: { notes: string }) {
  const t = useTranslations('adminJobs');
  return (
    <section className="mt-5 pt-3.5 border-t border-(--color-rule)">
      <div className="sm-smallcaps">{t('detail.privateNotes')}</div>
      <textarea
        value={notes} rows={3}
        readOnly
        data-testid="application-detail-notes"
        className="w-full sm-field-input sm-reading resize-y mt-1.5"
      />
      <p className="mono text-[10px] text-(--color-faint) tracking-[0.06em] mt-1">
        {t('detail.notesReadOnly')}
      </p>
    </section>
  );
}

// SNAPSHOT_SCALE_SMALL / _FULL —— the shrunk archive page in the card, and its "view bigger"
// scale. No new window, no download: the content is already here, zoom is pure presentation.
const SNAPSHOT_SCALE_SMALL = 0.42;
const SNAPSHOT_SCALE_FULL = 0.92;

function RightCol({
  app, state,
}: {
  app: Application;
  state: string;
}) {
  const [full, setFull] = useState(false);
  return (
    <div>
      <ResumeSnapshot app={app} scale={full ? SNAPSHOT_SCALE_FULL : SNAPSHOT_SCALE_SMALL} />
      <SnapshotActions full={full} onToggle={() => { setFull(!full); }} />
      <StatusBlock state={state} />
    </div>
  );
}

// ResumeSnapshot —— **renders the actual thing that was sent**.
//
// This block used to be a heading + a rule + one line of `resumeDelta`, and that field was
// only ever assigned an empty string on the frontend: so "what did I actually send" had no
// answer anywhere in the product (F-E-23). The content was always in the application row (the
// PDF at commit time was rendered from it) — the only thing missing was rendering it. This uses
// the same `ResumePage` component as the composer preview and the real PDF, so what's shown
// here is exactly what went out.
function ResumeSnapshot({ app, scale }: { app: Application; scale: number }) {
  const t = useTranslations('adminJobs');
  return (
    <section>
      <div className="sm-smallcaps">{t('detail.snapshotHead')}</div>
      <div className="mono text-[9px] text-(--color-muted) tracking-[0.06em] mt-0.5">
        {t('detail.tailoredFor', { company: app.company, role: app.role })}
      </div>
      <div className="mt-1.5 overflow-auto" data-testid="application-resume-snapshot">
        <ResumePage
          content={draftToResumeContent(app.resumeContent)}
          job={draftToJobContext(app.resumeContent)}
          qrURL={SNAPSHOT_QR_URL}
          pageIndex={0}
          pageCount={1}
          scale={scale}
        />
      </div>
    </section>
  );
}

// SNAPSHOT_QR_URL —— what's rendered here is the **archive**, not a file to send again. The QR
// on the real PDF points at this application's own access code, and the plaintext code only
// existed once, at commit time. What's shown here is an illustrative placeholder, not a claim
// that it's scannable.
const SNAPSHOT_QR_URL = '';

function SnapshotActions(
  { full, onToggle }: { full: boolean; onToggle: () => void },
) {
  const t = useTranslations('adminJobs');
  return (
    <div className="flex items-baseline gap-1.5 mt-2">
      <button
        type="button" onClick={onToggle}
        data-testid="application-resume-zoom"
        className="sm-btn sm-btn-outline sm-btn-sm"
      >
        {full ? t('detail.viewSmaller') : t('detail.viewFull')}
      </button>
      {/* Download stays disabled, and it's not just unwired: **the PDF isn't stored anywhere**.
          The `applications` table has no PDF column; the bytes only ever appeared once, in the
          `applications.commit` response. Enabling download requires first deciding whether to
          store the bytes or re-render on demand (F-E-13). **But "can't see the content" is no
          longer true** — the block above renders exactly what was sent. */}
      <button type="button" disabled title={t('detail.pdfNotKept')} className="sm-btn sm-btn-ghost sm-btn-sm">{t('detail.downloadPdf')}</button>
    </div>
  );
}

function StatusBlock({ state }: { state: string }) {
  const t = useTranslations('adminJobs');
  return (
    <section className="mt-4 px-3 py-2.5 border border-(--color-rule) rounded-[3px] bg-(--color-surface)/50">
      <div className="sm-smallcaps">{t('detail.status')}</div>
      <StatusSegmented value={state} />
    </section>
  );
}

// StatusSegmented —— **read-only** segmented control: shows this application's real state, not
// an editable/saveable control (rot-C1: no persistence path). Uses span rather than button —
// something that never persists shouldn't look clickable. It segments the **submission** axis
// (committed -> submitted / failed / withdrawn); the previous version segmented recruiter
// response, and the product can't even read that axis, let alone write to it (F-E-3).
function StatusSegmented({ value }: { value: string }) {
  return (
    <div className="sm-seg mt-1.5" data-testid="application-status" aria-readonly="true">
      {SUBMISSION_STATES.map((s) => (
        <span
          key={s}
          className={value === s ? 'is-on' : ''}
          data-testid={`status-${s}`}
        >
          {s}
        </span>
      ))}
    </div>
  );
}

function ModalFooter({ app, onClose }: { app: Application; onClose: () => void }) {
  const t = useTranslations('adminJobs');
  return (
    <div className="sm-app-modal-foot">
      <span className="mono text-[10px] text-(--color-faint) tracking-[0.06em]">
        {t('detail.footMeta', { committedAt: app.committedAt, method: app.method })}
      </span>
      {/* withdraw / log update are disabled: both need `applications.update_status`, and that
          write path isn't built yet (it's in the design: `docs/design/job-loop.md`, L.7
          deferred it). They used to be **clickable** — clicking did nothing: state unchanged,
          no request sent, not even a message — while withdraw still looked like a destructive
          action, so an owner who clicked it would believe the application was withdrawn
          (F-E-12). The day the write path is built, drop disabled **and** wire it up. */}
      <div className="flex items-baseline gap-2">
        <button type="button" disabled title={t('detail.needsWriter')} className="sm-btn sm-btn-danger sm-btn-sm">{t('detail.withdraw')}</button>
        <button type="button" disabled title={t('detail.needsWriter')} className="sm-btn sm-btn-outline sm-btn-sm">{t('detail.logUpdate')}</button>
        <button type="button" onClick={onClose} className="sm-btn sm-btn-solid sm-btn-sm">{t('detail.closeAction')}</button>
      </div>
    </div>
  );
}
