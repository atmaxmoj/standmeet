// ResumeComposer —— the full-screen split editor opened via "open composer →" from /admin/drafts.
// Left: 8-panel form. Right: the REAL Typst render of the draft (PreviewPane's iframe).
//
// The composer now PERSISTS: every edit debounce-saves through PATCH /drafts/{id}
// (useDraftAutosave), so the "saved" indicator is real and commit renders what the owner sees.
// "send →" opens a confirm modal → onSend, and the caller commits the (now persisted) draft.
//
// The old `match X / 100` gauge is gone (it was keyword overlap dressed as a score — owner: "完全
// 不知道怎么计算的，不要了"); the template picker lives in the preview toolbar (it changes that view).

'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

import { ComposerPanel } from '@/components/admin/composer/ComposerPanels';
import { PreviewPane } from '@/components/admin/composer/PreviewPane';
import {
  patchCustom,
  patchEducation,
  patchExperience,
  patchModel,
  patchSocial,
  type DraftCustom,
  type DraftEducation,
  type DraftExperience,
  type DraftModel,
  type DraftSocial,
} from '@/lib/admin/draft-model';
import { fetchTemplates } from '@/lib/admin/save-draft';
import { useDraftAutosave, type SaveStatus } from '@/lib/admin/use-draft-autosave';
import { useCodes, type CodeView } from '@/lib/admin/use-codes';
import { SelectField } from '@/components/atoms/SelectField';
import type { CodeChoice } from '@/lib/admin/commit-draft';

interface Props {
  initial: DraftModel;
  onClose: () => void;
  onSend: (choice: CodeChoice) => void;
}

export function ResumeComposer({ initial, onClose, onSend }: Props) {
  const [model, setModel] = useState<DraftModel>(initial);
  const [panel, setPanel] = useState<string>('header');
  const [confirm, setConfirm] = useState(false);
  const [templates, setTemplates] = useState<string[]>([]);
  // The code choice lives here (not in the send modal) so it's a visible, persistent composer
  // panel — the owner sees + picks it before send, instead of it being hidden until the confirm.
  const [codeChoice, setCodeChoice] = useState<CodeChoice>({ mode: 'new', codeId: '' });
  const { status, version } = useDraftAutosave(model);

  useEffect(() => { fetchTemplates().then(setTemplates).catch(() => setTemplates([])); }, []);

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
        savedLabel={savedLabelFor(status)}
        onClose={onClose}
        onSend={() => setConfirm(true)}
      />
      <div className="sm-composer-grid">
        <EditorPane
          panel={panel} onPanel={setPanel} model={model}
          onPatch={onPatch} onPatchExp={onPatchExp} onPatchEdu={onPatchEdu}
          onPatchSoc={onPatchSoc} onPatchCus={onPatchCus}
          codeChoice={codeChoice} onCodeChoice={setCodeChoice}
        />
        <PreviewPane
          draftID={model.id} template={model.template} version={version}
          templates={templates} fileName={fileNameFor(model)}
          onTemplate={(tp) => onPatch({ template: tp })}
        />
      </div>
      {confirm && (
        <ConfirmModal
          model={model}
          choice={codeChoice}
          onCancel={() => setConfirm(false)}
          onSend={() => { onSend(codeChoice); setConfirm(false); }}
        />
      )}
    </div>
  );
}

// savedLabelFor —— the top-bar indicator, driven by the real autosave status (a plain string, not
// an i18n literal — the same shape the old cosmetic label used).
const SAVE_LABELS: Record<SaveStatus, string> = {
  saving: 'saving…',
  error: 'save failed — retrying on next edit',
  saved: 'saved',
};

function savedLabelFor(status: SaveStatus): string {
  return SAVE_LABELS[status];
}

function fileNameFor(model: DraftModel): string {
  const co = (model.company || 'draft').toLowerCase().replace(/\s+/g, '-');
  return `resume_${co}.pdf`;
}

function ComposerTopBar({
  model, savedLabel, onClose, onSend,
}: {
  model: DraftModel;
  savedLabel: string;
  onClose: () => void;
  onSend: () => void;
}) {
  return (
    <header className="sm-composer-topbar">
      <ComposerCrumb model={model} onClose={onClose} />
      <ComposerActions savedLabel={savedLabel} onSend={onSend} />
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
  savedLabel, onSend,
}: { savedLabel: string; onSend: () => void }) {
  const t = useTranslations('adminShell.composer');
  return (
    // status (saved) | actions (regenerate / send).
    <div className="flex items-center gap-3">
      <span className="mono text-[10px] text-(--color-faint) tracking-[0.06em]" data-testid="composer-saved">
        {savedLabel}
      </span>
      <span className="sm-bar-sep" />
      <button type="button" className="sm-btn sm-btn-outline sm-btn-sm">
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

function EditorPane(props: {
  panel: string;
  onPanel: (p: string) => void;
  model: DraftModel;
  onPatch: (p: Partial<DraftModel>) => void;
  onPatchExp: (id: string, p: Partial<DraftExperience>) => void;
  onPatchEdu: (id: string, p: Partial<DraftEducation>) => void;
  onPatchSoc: (id: string, p: Partial<DraftSocial>) => void;
  onPatchCus: (id: string, p: Partial<DraftCustom>) => void;
  codeChoice: CodeChoice;
  onCodeChoice: (c: CodeChoice) => void;
}) {
  return (
    <div className="sm-composer-editor">
      <PanelRail panel={props.panel} onPanel={props.onPanel} />
      <div className="sm-composer-editor-body">
        <EditorBody {...props} />
      </div>
    </div>
  );
}

// EditorBody —— the 'code' panel is the send-time invitation choice (not part of the résumé's
// DraftModel), so it's rendered here rather than through ComposerPanel's model-shaped map.
function EditorBody(props: {
  panel: string;
  model: DraftModel;
  onPatch: (p: Partial<DraftModel>) => void;
  onPatchExp: (id: string, p: Partial<DraftExperience>) => void;
  onPatchEdu: (id: string, p: Partial<DraftEducation>) => void;
  onPatchSoc: (id: string, p: Partial<DraftSocial>) => void;
  onPatchCus: (id: string, p: Partial<DraftCustom>) => void;
  codeChoice: CodeChoice;
  onCodeChoice: (c: CodeChoice) => void;
}) {
  return props.panel === 'code'
    ? <CodePicker choice={props.codeChoice} onChoice={props.onCodeChoice} />
    : (
      <ComposerPanel
        panel={props.panel}
        model={props.model}
        onPatch={props.onPatch}
        onPatchExp={props.onPatchExp}
        onPatchEdu={props.onPatchEdu}
        onPatchSoc={props.onPatchSoc}
        onPatchCus={props.onPatchCus}
      />
    );
}

const PANELS = [
  { id: 'header', label: 'header' },
  { id: 'summary', label: 'summary' },
  { id: 'skills', label: 'skills' },
  { id: 'experience', label: 'experience' },
  { id: 'education', label: 'education' },
  { id: 'social', label: 'social' },
  { id: 'custom', label: 'custom' },
  { id: 'cover', label: 'cover letter' },
  // code —— which access code the résumé's QR carries (issue new / reuse existing). A send-time
  // choice, surfaced as a panel so it's discoverable before send, not buried in the confirm.
  { id: 'code', label: 'code' },
] as const;

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
  model, choice, onCancel, onSend,
}: { model: DraftModel; choice: CodeChoice; onCancel: () => void; onSend: () => void }) {
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
        {/* The code is picked in the composer's `code` panel; here we only confirm which one. */}
        <p className="mono text-[11px] text-(--color-muted) mt-3" data-testid="composer-confirm-code">
          {choice.mode === 'existing' ? t('codeExisting') : t('codeNew')}
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

// CodePicker —— the résumé's QR is a live-chat invitation; this makes that connection explicit and
// lets the owner choose WHICH code it carries: a fresh one (default), or an existing active code.
function CodePicker({
  choice, onChoice,
}: { choice: CodeChoice; onChoice: (c: CodeChoice) => void }) {
  const t = useTranslations('adminShell.composer');
  const { codes } = useCodes();
  const active = codes.filter((c) => c.status === 'active');
  return (
    <div className="mt-4 border-t border-(--color-rule) pt-3" data-testid="composer-code-picker">
      <div className="mono text-[10px] tracking-[0.16em] uppercase text-(--color-muted) mb-2">
        {t('codeHeading')}
      </div>
      <div className="flex flex-col gap-2">
        <CodeModeButton
          label={t('codeNew')} active={choice.mode === 'new'}
          testid="composer-code-new" onClick={() => onChoice({ mode: 'new', codeId: '' })}
        />
        <CodeExistingRow choice={choice} active={active} onChoice={onChoice} />
      </div>
    </div>
  );
}

function CodeExistingRow({
  choice, active, onChoice,
}: { choice: CodeChoice; active: readonly CodeView[]; onChoice: (c: CodeChoice) => void }) {
  const t = useTranslations('adminShell.composer');
  return active.length === 0 ? null : (
    <div className="flex items-center gap-2">
      <CodeModeButton
        label={t('codeExisting')} active={choice.mode === 'existing'}
        testid="composer-code-existing"
        onClick={() => onChoice({ mode: 'existing', codeId: active[0]?.id ?? '' })}
      />
      {choice.mode === 'existing' ? (
        <SelectField
          testid="composer-code-existing-select"
          aria-label="existing code"
          value={choice.codeId}
          onChange={(e) => onChoice({ mode: 'existing', codeId: e.target.value })}
          mono
        >
          {active.map((c) => <option key={c.id} value={c.id}>{c.label} · {c.code}</option>)}
        </SelectField>
      ) : null}
    </div>
  );
}

function CodeModeButton({
  label, active, testid, onClick,
}: { label: string; active: boolean; testid: string; onClick: () => void }) {
  return (
    <button
      type="button" onClick={onClick} data-testid={testid}
      className={`mono text-[11px] tracking-[0.06em] text-left px-3 py-2 border rounded-[3px] ${
        active
          ? 'border-(--color-accent) text-(--color-ink)'
          : 'border-(--color-rule) text-(--color-muted) hover:text-(--color-ink)'
      }`}
      aria-pressed={active}
    >
      {label}
    </button>
  );
}
