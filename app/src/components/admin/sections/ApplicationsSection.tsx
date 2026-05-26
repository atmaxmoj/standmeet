// ApplicationsSection —— /admin/applications。owner 看 job-loop 已发的
// 申请。每条 card 点开 ApplicationDetailModal。
//
// 设计源 docs/design/project/admin.js ApplicationsSection (1910-1948)。
//
// Data: mock fixture（等后端 `GET /api/admin/applications` 落地切真 fetch）。

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

export function ApplicationsSection() {
  const [opened, setOpened] = useState<Application | null>(null);
  return (
    <>
      <SectionHeader
        kicker="jobs · sent"
        title="applications"
        count={`${MOCK_APPLICATIONS.length} sent`}
      />
      <Intro />
      <List apps={MOCK_APPLICATIONS} onOpen={setOpened} />
      {opened && (
        <ApplicationDetailModal app={opened} onClose={() => setOpened(null)} />
      )}
    </>
  );
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

function List({
  apps, onOpen,
}: { apps: readonly Application[]; onOpen: (a: Application) => void }) {
  return (
    <div className="space-y-3" data-testid="applications-list">
      {apps.length === 0
        ? <EmptyState />
        : apps.map((a) => <Row key={a.id} app={a} onOpen={() => onOpen(a)} />)}
    </div>
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

function Row({ app, onOpen }: { app: Application; onOpen: () => void }) {
  return (
    <button
      type="button" onClick={onOpen}
      data-testid={`application-row-${app.id}`}
      className="w-full text-left border border-(--color-rule) rounded-[3px] p-4 hover:border-(--color-ink) transition-colors"
    >
      <RowHead app={app} />
      <RowMeta app={app} />
    </button>
  );
}

function RowHead({ app }: { app: Application }) {
  return (
    <div className="flex items-baseline justify-between gap-4 flex-wrap">
      <div>
        <span className="font-serif text-[17px] text-(--color-ink) font-medium">
          {app.company}
        </span>
        <span className="font-serif italic text-[15px] text-(--color-muted) ml-2">
          · {app.role}
        </span>
      </div>
      <StatusPill status={app.status} />
    </div>
  );
}

function RowMeta({ app }: { app: Application }) {
  return (
    <div className="mono text-[10px] tracking-[0.14em] uppercase text-(--color-muted) flex items-baseline gap-3 flex-wrap mt-2">
      <span>sent {app.sentAt}</span>
      <span className="text-(--color-faint)">·</span>
      <span>{app.method}</span>
      <span className="text-(--color-faint)">·</span>
      <span className="lowercase tracking-[0.04em]">{app.contact}</span>
    </div>
  );
}

function StatusPill({ status }: { status: ApplicationStatus }) {
  return (
    <span className={`sm-pill ${pillToneFor(status)}`}>
      <span className="sm-dot-mark" />
      {status}
    </span>
  );
}
