// ResumeComposer —— the full-screen split editor opened via "open composer →" from
// /admin/drafts. Left: 6-panel form. Right: PDF-shape preview (doesn't render a real PDF, only
// reflects letter-spacing / paragraphs / smallcaps so the owner can see the layout while
// editing).
//
// Design source: docs/design/project/admin.js ResumeComposer.
//
// Note: the real freeze + applications.commit for drafts happens on the MCP path (job loop
// memory) — this is only the editing layer. "send →" opens a confirm modal -> calls the onSend
// callback, and the caller does the MCP/REST commit.

'use client';

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';

import { ComposerPanel } from '@/components/admin/composer/ComposerPanels';
import { PreviewPane } from '@/components/admin/composer/PreviewPane';
import {
  patchCustom,
  patchEducation,
  patchExperience,
  patchModel,
  patchSocial,
  useMatchPct,
  type DraftCustom,
  type DraftEducation,
  type DraftExperience,
  type DraftModel,
  type DraftSocial,
} from '@/lib/admin/draft-model';
import { useDebouncedSavedLabel } from '@/lib/admin/use-debounced-saved-label';
import { cssVars } from '@/lib/ui/css-vars';

const PANELS = [
  { id: 'header',     label: 'header' },
  { id: 'summary',    label: 'summary' },
  { id: 'skills',     label: 'skills' },
  { id: 'experience', label: 'experience' },
  { id: 'education',  label: 'education' },
  { id: 'social',     label: 'social' },
  { id: 'custom',     label: 'custom' },
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
  const onPatchSoc = useCallback((id: string, p: Partial<DraftSocial>) => {
    setModel((m) => patchSocial(m, id, p));
  }, []);
  const onPatchCus = useCallback((id: string, p: Partial<DraftCustom>) => {
    setModel((m) => patchCustom(m, id, p));
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
          onPatchSoc={onPatchSoc} onPatchCus={onPatchCus}
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
  const t = useTranslations('adminShell.composer');
  return (
    <div className="flex items-baseline gap-3 min-w-0">
      <button
        type="button" onClick={onClose}
        className="mono text-[11px] tracking-[0.14em] uppercase text-(--color-muted) hover:text-(--color-ink) bg-transparent"
        data-testid="composer-back"
      >
        {t('backToDrafts')}
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
  const t = useTranslations('adminShell.composer');
  return (
    // Three segments separated by a vertical bar: judgment of it (match) | status (saved) |
    // actions (regenerate / send).
    <div className="flex items-center gap-3">
      <MatchGauge pct={matchPct} />
      <span className="sm-bar-sep" />
      <span className="mono text-[10px] text-(--color-faint) tracking-[0.06em]">
        {savedLabel}
      </span>
      <span className="sm-bar-sep" />
      <button
        type="button"
        className="sm-btn sm-btn-outline sm-btn-sm"
      >
        {t('regenerate')}
      </button>
      <button
        type="button" onClick={onSend}
        className="sm-btn sm-btn-solid sm-btn-sm"
        data-testid="composer-send"
      >
        {t('send')}
      </button>
    </div>
  );
}

function MatchGauge({ pct }: { pct: number }) {
  const t = useTranslations('adminShell.composer');
  return (
    <div className="sm-session-strip-gauge" title={t('matchTitle')}>
      <span className="sm-session-strip-gauge-text flex items-baseline gap-1.5">
        {t('match')}
        <span className="sm-match-num" data-testid="composer-match-num">{pct}</span>
        <span>{t('matchOutOf')}</span>
      </span>
      <MatchGaugeBar pct={pct} />
    </div>
  );
}

// MatchGaugeBar —— this bar has **two independent causes** that can each make it render
// nothing; either one alone is enough:
//
//  1. The fill percentage used to be written as a concatenated Tailwind arbitrary value, which
//     the build-time scanner can't see -> not a single line of CSS gets generated, and
//     `.sm-fill` falls back to its default `width: 0%`. Now it goes through `style`.
//  2. `.sm-fill` **only has width** — height and background color live in
//     `.sm-session-strip-gauge-fill`, and this element used to carry only the former, so even
//     with the right width the box was still 0 tall and colorless.
//
// Both had to be fixed before it becomes visible, so **fixing only one still left a blank
// bar** — which is exactly why it went unnoticed for so long: every "quick tweak" produced no
// visible payoff, so nobody ever confirmed whether it actually rendered
// (see [[names-that-lie]]: the number next to it was always correct, only the bar was fake).
function MatchGaugeBar({ pct }: { pct: number }) {
  return (
    <span className="sm-session-strip-gauge-bar" data-testid="composer-match-track">
      <span
        className="sm-session-strip-gauge-fill sm-fill"
        data-testid="composer-match-fill"
        // eslint-disable-next-line no-restricted-syntax -- pct is a runtime match percentage; only style can carry it
        style={cssVars({ '--fill': `${pct}%` })}
      />
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
  onPatchSoc: (id: string, p: Partial<DraftSocial>) => void;
  onPatchCus: (id: string, p: Partial<DraftCustom>) => void;
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
          onPatchSoc={props.onPatchSoc}
          onPatchCus={props.onPatchCus}
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
  const t = useTranslations('adminShell.composer');
  return (
    <div className="sm-fadein sm-composer-confirm-overlay" onClick={onCancel}>
      <div
        className="sm-composer-confirm-card sm-rise"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sm-smallcaps">{t('freezeAndSend')}</div>
        <h3 className="font-serif text-[22px] text-(--color-ink) font-normal mt-1.5">
          {t('confirmTitle', { company: model.company })}
        </h3>
        <p className="sm-reading text-(--color-muted) text-[14.5px] mt-2">
          {t('confirmBody')}
        </p>
        <div className="flex items-center justify-end gap-3 mt-5">
          <button type="button" onClick={onCancel} className="sm-btn sm-btn-ghost">
            {t('keepEditing')}
          </button>
          <button
            type="button" onClick={onSend}
            className="sm-btn sm-btn-accent"
            data-testid="composer-confirm-send"
          >
            {t('send')}
          </button>
        </div>
      </div>
    </div>
  );
}
