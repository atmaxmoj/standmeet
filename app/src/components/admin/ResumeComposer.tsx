// ResumeComposer —— /admin/drafts 里点 "open composer →" 进入的全屏分屏
// editor。左侧 6-panel 表单 + 右侧 PDF-shape 预览（不 render 真 PDF，
// 只 reflect 字距 / 段落 / smallcaps 让 owner 边编辑边看版式）。
//
// 设计源 docs/design/project/admin.js ResumeComposer。
//
// 注意：drafts 的真正 freeze + applications.commit 在 MCP 路径（job loop
// memory），这里只是编辑层。"send →" 弹 confirm 模态 → 调 onSend
// callback，caller 走 MCP/REST commit。

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
    <div className="flex items-center gap-3">
      <MatchGauge pct={matchPct} />
      <span className="mono text-[10px] text-(--color-faint) tracking-[0.06em]">
        {savedLabel}
      </span>
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
      <span className="sm-session-strip-gauge-text">
        {t('match')}
        <span className="sm-session-strip-used ml-2">{pct}</span>
        <span className="ml-1">{t('matchOutOf')}</span>
      </span>
      <MatchGaugeBar pct={pct} />
    </div>
  );
}

// MatchGaugeBar —— 填充比例走 `style`,不走拼出来的类名。
// 拼接的 Tailwind 任意属性构建期扫不到,一条 CSS 都不生成,`.sm-fill` 于是一直退到兜底的
// `width: 0%` —— **这根条从来没显示过任何数值**,而它的名字说它在显示匹配度([[names-that-lie]])。
function MatchGaugeBar({ pct }: { pct: number }) {
  return (
    <span className="sm-session-strip-gauge-bar">
      {/* eslint-disable-next-line no-restricted-syntax -- pct 是运行时算出来的匹配度，只有 style 能承载 */}
      <span className="sm-fill" style={cssVars({ '--fill': `${pct}%` })} />
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
