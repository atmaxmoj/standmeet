// ApplicationDetailModal —— /admin/applications 里点 card 弹的详情。
// 左侧 timeline + contact + notes；右侧 resume snapshot + status segmented。
//
// 设计源 docs/design/project/admin.js ApplicationDetailModal (1825-1908)。
// 当前是只读 mock 视图；status PATCH 走后端的 applications endpoint。

'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

import {
  APPLICATION_STATUSES,
  timelineFor,
  type Application,
  type ApplicationStatus,
  type TimelineEvent,
} from '@/lib/admin/applications-model';

interface Props {
  app: Application;
  onClose: () => void;
}

export function ApplicationDetailModal({ app, onClose }: Props) {
  const [status, setStatus] = useState<ApplicationStatus>(app.status);
  const [notes, setNotes] = useState(app.notes);
  return (
    <div className="sm-app-modal-overlay sm-fadein" onClick={onClose}>
      <div
        className="sm-app-modal-card sm-rise"
        onClick={(e) => e.stopPropagation()}
        data-testid="application-detail-modal"
      >
        <ModalHeader app={app} onClose={onClose} />
        <ModalBody
          app={{ ...app, status, notes }}
          status={status} onStatus={setStatus}
          notes={notes} onNotes={setNotes}
        />
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
  status: ApplicationStatus;
  onStatus: (s: ApplicationStatus) => void;
  notes: string;
  onNotes: (v: string) => void;
}

function ModalBody(props: BodyProps) {
  return (
    <div className="sm-app-modal-body">
      <LeftCol app={props.app} notes={props.notes} onNotes={props.onNotes} />
      <RightCol app={props.app} status={props.status} onStatus={props.onStatus} />
    </div>
  );
}

function LeftCol({
  app, notes, onNotes,
}: { app: Application; notes: string; onNotes: (v: string) => void }) {
  return (
    <div>
      <Timeline events={timelineFor(app)} />
      <ContactBlock contact={app.contact} />
      <NotesBlock notes={notes} onNotes={onNotes} />
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
      <button type="button" className="sm-btn sm-btn-outline sm-btn-sm mt-2">
        {t('detail.pingInChat')}
      </button>
    </section>
  );
}

function NotesBlock({
  notes, onNotes,
}: { notes: string; onNotes: (v: string) => void }) {
  const t = useTranslations('adminJobs');
  return (
    <section className="mt-5 pt-3.5 border-t border-(--color-rule)">
      <div className="sm-smallcaps">{t('detail.privateNotes')}</div>
      <textarea
        value={notes} rows={3}
        onChange={(e) => onNotes(e.target.value)}
        data-testid="application-detail-notes"
        className="w-full sm-field-input sm-reading resize-y mt-1.5"
      />
    </section>
  );
}

function RightCol({
  app, status, onStatus,
}: {
  app: Application;
  status: ApplicationStatus;
  onStatus: (s: ApplicationStatus) => void;
}) {
  return (
    <div>
      <ResumeSnapshot app={app} />
      <SnapshotActions />
      <StatusBlock status={status} onStatus={onStatus} />
    </div>
  );
}

function ResumeSnapshot({ app }: { app: Application }) {
  const t = useTranslations('adminJobs');
  return (
    <section>
      <div className="sm-smallcaps">{t('detail.snapshotHead')}</div>
      <div className="sm-app-snapshot mt-1.5">
        <div className="font-serif text-[18px] font-medium">{t('detail.resume')}</div>
        <div className="mono text-[9px] text-(--color-muted) tracking-[0.06em] mt-0.5">
          {t('detail.tailoredFor', { company: app.company, role: app.role })}
        </div>
        <hr className="border-(--color-rule) my-2.5" />
        <p className="font-serif italic text-(--color-accent) text-[12px] leading-[1.4]">
          {app.resumeDelta}
        </p>
      </div>
    </section>
  );
}

function SnapshotActions() {
  const t = useTranslations('adminJobs');
  return (
    <div className="flex items-baseline gap-1.5 mt-2">
      <button type="button" className="sm-btn sm-btn-outline sm-btn-sm">{t('detail.viewFull')}</button>
      <button type="button" className="sm-btn sm-btn-ghost sm-btn-sm">{t('detail.downloadPdf')}</button>
    </div>
  );
}

function StatusBlock({
  status, onStatus,
}: { status: ApplicationStatus; onStatus: (s: ApplicationStatus) => void }) {
  const t = useTranslations('adminJobs');
  return (
    <section className="mt-4 px-3 py-2.5 border border-(--color-rule) rounded-[3px] bg-(--color-surface)/50">
      <div className="sm-smallcaps">{t('detail.status')}</div>
      <StatusSegmented value={status} onChange={onStatus} />
    </section>
  );
}

function StatusSegmented({
  value, onChange,
}: { value: ApplicationStatus; onChange: (s: ApplicationStatus) => void }) {
  return (
    <div className="sm-seg mt-1.5" data-testid="application-status">
      {APPLICATION_STATUSES.map((s) => (
        <button
          key={s} type="button"
          onClick={() => onChange(s)}
          className={value === s ? 'is-on' : ''}
          data-testid={`status-${s}`}
        >
          {s}
        </button>
      ))}
    </div>
  );
}

function ModalFooter({ app, onClose }: { app: Application; onClose: () => void }) {
  const t = useTranslations('adminJobs');
  return (
    <div className="sm-app-modal-foot">
      <span className="mono text-[10px] text-(--color-faint) tracking-[0.06em]">
        {t('detail.footMeta', { sentAt: app.sentAt, method: app.method })}
      </span>
      <div className="flex items-baseline gap-2">
        <button type="button" className="sm-btn sm-btn-danger sm-btn-sm">{t('detail.withdraw')}</button>
        <button type="button" className="sm-btn sm-btn-outline sm-btn-sm">{t('detail.logUpdate')}</button>
        <button type="button" onClick={onClose} className="sm-btn sm-btn-solid sm-btn-sm">{t('detail.closeAction')}</button>
      </div>
    </div>
  );
}
