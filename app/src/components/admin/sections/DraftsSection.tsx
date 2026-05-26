// DraftsSection —— /admin/drafts。owner 看 job-loop 路径里 Claude 起的
// resume drafts，每个 card 可"open composer →"进 ResumeComposer。
//
// 设计源 docs/design/project/admin.js DraftsSection + DraftCard (1756-1822)。
//
// 注意：drafts 真实数据由 MCP `resume.draft` 起 + Redis 1d TTL 缓存（job
// loop memory）。当前 admin 还没接 REST list endpoint —— 这一版用 mock
// fixture，等后端 add `GET /api/admin/drafts` 时切真 fetch。

'use client';

import { useState } from 'react';

import { SectionHeader } from '@/components/admin/SectionHeader';
import { ResumeComposer } from '@/components/admin/ResumeComposer';
import { mockDraft } from '@/lib/admin/draft-model';

interface DraftCardData {
  id: string;
  company: string;
  role: string;
  forJob: string;
  matchPct: number;
  updatedAt: string;
}

const MOCK_DRAFTS: readonly DraftCardData[] = [
  {
    id: 'd-1', company: 'Anthropic',
    role: 'Member of Technical Staff · retrieval',
    forJob: 'anthropic-mts-retrieval-2026',
    matchPct: 86, updatedAt: '4 minutes ago',
  },
  {
    id: 'd-2', company: 'OpenAI',
    role: 'Research Engineer · long-context',
    forJob: 'openai-re-longctx-2026',
    matchPct: 72, updatedAt: '2 hours ago',
  },
];

export function DraftsSection() {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <>
      <SectionHeader
        kicker="outbound · resumes"
        title="drafts"
        count={`${MOCK_DRAFTS.length} pending`}
      />
      <Intro />
      <DraftList drafts={MOCK_DRAFTS} onOpen={setOpenId} />
      {openId !== null && (
        <ResumeComposer
          initial={mockDraft(openId)}
          onClose={() => setOpenId(null)}
          onSend={() => setOpenId(null)}
        />
      )}
    </>
  );
}

function Intro() {
  return (
    <p className="reading-tight text-(--color-muted) mb-6 text-[15px] max-w-[54em]">
      Tailored resumes Claude drafted for jobs you said yes to. Open the composer to
      edit + preview; <span className="text-(--color-ink)">send</span> freezes the
      snapshot, renders the final PDF (with QR), and auto-issues an AccessCode.
    </p>
  );
}

function DraftList({
  drafts, onOpen,
}: { drafts: readonly DraftCardData[]; onOpen: (id: string) => void }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {drafts.map((d) => <DraftCard key={d.id} draft={d} onOpen={() => onOpen(d.id)} />)}
    </div>
  );
}

function DraftCard({
  draft, onOpen,
}: { draft: DraftCardData; onOpen: () => void }) {
  return (
    <article className="border border-(--color-rule) rounded-[3px] p-4 hover:border-(--color-ink) transition-colors">
      <DraftCardHead company={draft.company} role={draft.role} />
      <DraftCardMeta matchPct={draft.matchPct} updatedAt={draft.updatedAt} />
      <DraftCardActions onOpen={onOpen} draftId={draft.id} />
    </article>
  );
}

function DraftCardHead({ company, role }: { company: string; role: string }) {
  return (
    <header className="mb-3">
      <h3 className="font-serif text-[18px] text-(--color-ink) font-medium tracking-[-0.005em]">
        {company}
      </h3>
      <p className="font-serif italic text-[14px] text-(--color-muted) mt-0.5">
        {role}
      </p>
    </header>
  );
}

function DraftCardMeta({ matchPct, updatedAt }: { matchPct: number; updatedAt: string }) {
  return (
    <div className="mono text-[10px] tracking-[0.14em] uppercase text-(--color-muted) flex items-baseline gap-3 flex-wrap mb-4">
      <span>match · <span className="text-(--color-ink) tabular-nums">{matchPct}%</span></span>
      <span className="text-(--color-faint)">·</span>
      <span>updated {updatedAt}</span>
    </div>
  );
}

function DraftCardActions({ onOpen, draftId }: { onOpen: () => void; draftId: string }) {
  return (
    <div className="flex items-baseline gap-3">
      <button
        type="button" onClick={onOpen}
        className="sm-btn sm-btn-outline sm-btn-sm"
        data-testid={`draft-open-${draftId}`}
      >
        open composer →
      </button>
    </div>
  );
}
