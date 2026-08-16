// ApplicationDetailModal —— /admin/applications 里点 card 弹的详情。
// 左侧 timeline + contact + notes；右侧 resume snapshot + status segmented。
//
// 设计源 docs/design/project/admin.js ApplicationDetailModal。
// status 是只读展示（rot-C1：无持久化路径，写只走 MCP applications.commit）。

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

// status 是**只读**的（rot-C1）：它反映后端 application 行的真实生命周期，这个 modal 没有持久化
// 路径（/applications 只 GET，写只走 MCP applications.commit）。曾经它是一个 local useState 的可点
// 分段控件 —— 看着能改能存，一 reload 就变回去。那是"看着像存了、其实没存"的谎。现在只读展示。
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
      {/* 禁用中：没有联系人、也没有从这里发起对话的通道（F-E-13）。它原来是能点的、点了什么都不发生。 */}
      <button type="button" disabled title={t('detail.needsWriter')} className="sm-btn sm-btn-outline sm-btn-sm mt-2">
        {t('detail.pingInChat')}
      </button>
    </section>
  );
}

// NotesBlock —— **只读**，跟上面的 status 段控同一个理由：这条链上没有任何东西存 notes。
//
// 它原来是个普通可编辑的多行框：owner 写一句话、关掉、重新加载，字就没了，而且从头到尾
// 没有保存按钮、没有任何提示、后端连一个写请求都没收到（F-E-11）。三层都是空的 ——
// 前端纯 useState，列表把 notes 硬编码成 ''，后端整个 jobs 包 `notes` 零命中。
//
// 设计里这一格是有的（`docs/design/job-loop.md` 的 schema + `applications.update_status`），
// 但那个写口还没建。**在它建起来之前，这里不该长得像一个能存的字段**；那一天到了，
// 把 readOnly 去掉、接上写口，这条注释和守卫会一起提醒要两件事都做。
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

// SNAPSHOT_SCALE_SMALL / _FULL —— 卡片里那张缩小的存档页，和「看大一点」之后的样子。
// 不开新窗口、也不下载：内容就在手上，放大是纯呈现。
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

// ResumeSnapshot —— **发出去的那一份，画出来**。
//
// 这块以前是一个标题 + 一条横线 + 一行 `resumeDelta`，而那个字段在前端只被赋成空串：
// 于是「我到底发出去了什么」在整个产品里没有一处能回答（F-E-23）。内容一直都在申请行里
// （commit 那一刻的 PDF 就是从它渲的），缺的只是把它渲出来 —— 用的还是同一个
// `ResumePage`，跟 composer 预览、跟真 PDF 是同一个组件，所以这里看到的就是寄出去的样子。
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

// SNAPSHOT_QR_URL —— 这里画的是**存档**，不是要再发一次的文件。真 PDF 上那颗 QR 指向
// 这次申请自己的 access code，而 code 的明文只在 commit 那一刻存在过一次；这里放一个
// 说明性的占位，不假装它是可扫的。
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
      {/* 下载那颗还禁着，而且不是没接线：**那份 PDF 没有存在任何地方**。`applications` 表
          没有 PDF 列，字节只在 `applications.commit` 的回参里出现过一次。要能下载，得先决定
          存 bytes 还是按需重渲（F-E-13）。**但「看不到内容」已经不成立了** —— 上面那块画的
          就是寄出去的那一份。 */}
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

// StatusSegmented —— **只读**分段：展示这条 application 的真实状态，不是一个能改能存的控件
// （rot-C1：没有持久化路径）。用 span 而非 button —— 一个不落库的东西不该看起来能点。
// 分的是**投递**这条轴(committed → submitted / failed / withdrawn);上一版分的是
// recruiter 回没回,而产品对那条轴连读都读不到,更没有写口(F-E-3)。
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
      {/* withdraw / log update 禁用中：两颗都要 `applications.update_status`，而那个写口还没建
          （设计里有：`docs/design/job-loop.md`，L.7 把它推后了）。它们原来是**能点的**，点下去
          状态不变、一个请求不发、连一句话都没有 —— 而 withdraw 还长着破坏性动作的样子，
          owner 点完会以为这份申请撤回了（F-E-12）。写口建好那天，去掉 disabled **并且**接上它。 */}
      <div className="flex items-baseline gap-2">
        <button type="button" disabled title={t('detail.needsWriter')} className="sm-btn sm-btn-danger sm-btn-sm">{t('detail.withdraw')}</button>
        <button type="button" disabled title={t('detail.needsWriter')} className="sm-btn sm-btn-outline sm-btn-sm">{t('detail.logUpdate')}</button>
        <button type="button" onClick={onClose} className="sm-btn sm-btn-solid sm-btn-sm">{t('detail.closeAction')}</button>
      </div>
    </div>
  );
}
