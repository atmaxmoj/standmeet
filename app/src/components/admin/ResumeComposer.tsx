// ResumeComposer —— /admin/drafts 里点 "open composer →" 进入的全屏分屏
// editor。左侧 6-panel 表单 + 右侧 PDF-shape 预览（不 render 真 PDF，
// 只 reflect 字距 / 段落 / smallcaps 让 owner 边编辑边看版式）。
//
// 设计源 docs/design/project/admin.js ResumeComposer (1467-1680)。
//
// 注意：drafts 的真正 freeze + applications.commit 在 MCP 路径（job loop
// memory），这里只是编辑层。"send →" 弹 confirm 模态 → 调 onSend
// callback，caller 走 MCP/REST commit。

'use client';

import { useCallback, useState } from 'react';

import { ComposerPanel } from '@/components/admin/composer/ComposerPanels';
import { PreviewPane } from '@/components/admin/composer/PreviewPane';
import {
  patchEducation,
  patchExperience,
  patchModel,
  useMatchPct,
  type DraftEducation,
  type DraftExperience,
  type DraftModel,
} from '@/lib/admin/draft-model';
import { useDebouncedSavedLabel } from '@/lib/admin/use-debounced-saved-label';

const PANELS = [
  { id: 'header',     label: 'header' },
  { id: 'summary',    label: 'summary' },
  { id: 'skills',     label: 'skills' },
  { id: 'experience', label: 'experience' },
  { id: 'education',  label: 'education' },
  { id: 'cover',      label: 'cover letter' },
] as const;

interface Props {
  initial: DraftModel;
  onClose: () => void;
  onSend: (model: DraftModel) => void;
}

export function ResumeComposer({ initial, onClose, onSend }: Props) {
  const [model, setModel] = useState<DraftModel>(initial);
  const [panel, setPanel] = useState<string>('header');
  const [zoom, setZoom] = useState(0.62);
  const [page, setPage] = useState(0);
  const [confirm, setConfirm] = useState(false);
  const savedLabel = useDebouncedSavedLabel(model);
  const matchPct = useMatchPct(model);

  const onPatch = useCallback((p: Partial<DraftModel>) => {
    setModel((m) => patchModel(m, p));
  }, []);
  const onPatchExp = useCallback((id: string, p: Partial<DraftExperience>) => {
    setModel((m) => patchExperience(m, id, p));
  }, []);
  const onPatchEdu = useCallback((id: string, p: Partial<DraftEducation>) => {
    setModel((m) => patchEducation(m, id, p));
  }, []);

  return (
    <div className="sm-composer-overlay" data-testid="resume-composer">
      <ComposerTopBar
        model={model}
        matchPct={matchPct}
        savedLabel={savedLabel}
        onClose={onClose}
        onSend={() => setConfirm(true)}
      />
      <div className="sm-composer-grid">
        <EditorPane
          panel={panel} onPanel={setPanel} model={model}
          onPatch={onPatch} onPatchExp={onPatchExp} onPatchEdu={onPatchEdu}
        />
        <PreviewPane
          model={model} zoom={zoom} page={page}
          onZoom={setZoom} onPage={setPage}
        />
      </div>
      {confirm && (
        <ConfirmModal
          model={model}
          onCancel={() => setConfirm(false)}
          onSend={() => { onSend(model); setConfirm(false); }}
        />
      )}
    </div>
  );
}

function ComposerTopBar({
  model, matchPct, savedLabel, onClose, onSend,
}: {
  model: DraftModel;
  matchPct: number;
  savedLabel: string;
  onClose: () => void;
  onSend: () => void;
}) {
  return (
    <header className="sm-composer-topbar">
      <ComposerCrumb model={model} onClose={onClose} />
      <ComposerActions matchPct={matchPct} savedLabel={savedLabel} onSend={onSend} />
    </header>
  );
}

function ComposerCrumb({ model, onClose }: { model: DraftModel; onClose: () => void }) {
  return (
    <div className="flex items-baseline gap-3 min-w-0">
      <button
        type="button" onClick={onClose}
        className="mono text-[11px] tracking-[0.14em] uppercase text-(--color-muted) hover:text-(--color-ink) bg-transparent"
        data-testid="composer-back"
      >
        ← drafts
      </button>
      <span className="text-(--color-faint)">/</span>
      <span className="mono text-[11px] tracking-[0.06em] text-(--color-ink) truncate">
        {model.company} <span className="text-(--color-muted)">· {model.role}</span>
      </span>
    </div>
  );
}

function ComposerActions({
  matchPct, savedLabel, onSend,
}: { matchPct: number; savedLabel: string; onSend: () => void }) {
  return (
    <div className="flex items-center gap-3">
      <MatchGauge pct={matchPct} />
      <span className="mono text-[10px] text-(--color-faint) tracking-[0.06em]">
        {savedLabel}
      </span>
      <button
        type="button"
        className="sm-btn sm-btn-outline sm-btn-sm"
      >
        regenerate ⌖
      </button>
      <button
        type="button" onClick={onSend}
        className="sm-btn sm-btn-solid sm-btn-sm"
        data-testid="composer-send"
      >
        send →
      </button>
    </div>
  );
}

function MatchGauge({ pct }: { pct: number }) {
  return (
    <div className="sm-session-strip-gauge" title="match against the job description">
      <span className="sm-session-strip-gauge-text">
        match
        <span className="sm-session-strip-used ml-2">{pct}</span>
        <span className="ml-1">/ 100</span>
      </span>
      <MatchGaugeBar pct={pct} />
    </div>
  );
}

function MatchGaugeBar({ pct }: { pct: number }) {
  return (
    <span className="sm-session-strip-gauge-bar">
      <span className={`sm-fill [--fill:${pct}%]`} />
    </span>
  );
}

function EditorPane(props: {
  panel: string;
  onPanel: (p: string) => void;
  model: DraftModel;
  onPatch: (p: Partial<DraftModel>) => void;
  onPatchExp: (id: string, p: Partial<DraftExperience>) => void;
  onPatchEdu: (id: string, p: Partial<DraftEducation>) => void;
}) {
  return (
    <div className="sm-composer-editor">
      <PanelRail panel={props.panel} onPanel={props.onPanel} />
      <div className="sm-composer-editor-body">
        <ComposerPanel
          panel={props.panel}
          model={props.model}
          onPatch={props.onPatch}
          onPatchExp={props.onPatchExp}
          onPatchEdu={props.onPatchEdu}
        />
      </div>
    </div>
  );
}

function PanelRail({
  panel, onPanel,
}: { panel: string; onPanel: (p: string) => void }) {
  return (
    <nav className="sm-composer-rail">
      {PANELS.map((p) => (
        <button
          key={p.id} type="button"
          onClick={() => onPanel(p.id)}
          className={`sm-composer-rail-link ${panel === p.id ? 'is-active' : ''}`}
          data-testid={`composer-panel-${p.id}`}
        >
          {p.label}
        </button>
      ))}
    </nav>
  );
}

function ConfirmModal({
  model, onCancel, onSend,
}: { model: DraftModel; onCancel: () => void; onSend: () => void }) {
  return (
    <div className="sm-fadein sm-composer-confirm-overlay" onClick={onCancel}>
      <div
        className="sm-composer-confirm-card sm-rise"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sm-smallcaps">freeze + send</div>
        <h3 className="font-serif text-[22px] text-(--color-ink) font-normal mt-1.5">
          Send this draft to {model.company}?
        </h3>
        <p className="sm-reading text-(--color-muted) text-[14.5px] mt-2">
          Sending will freeze the resume + cover letter snapshot, render the final
          PDF (with QR), and write an application row. The auto-issued AccessCode
          will be 180 days, 10 sessions, 50 turns.
        </p>
        <div className="flex items-center justify-end gap-3 mt-5">
          <button type="button" onClick={onCancel} className="sm-btn sm-btn-ghost">
            ← keep editing
          </button>
          <button
            type="button" onClick={onSend}
            className="sm-btn sm-btn-accent"
            data-testid="composer-confirm-send"
          >
            send →
          </button>
        </div>
      </div>
    </div>
  );
}
