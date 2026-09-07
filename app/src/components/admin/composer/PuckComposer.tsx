// PuckComposer —— the full-page résumé composer (owner-chosen layout A): a top action bar
// (← drafts · Save · code▾ · preview PDF ↗ · SEND) over the full-page Puck editor. Puck owns the
// editor state; Save persists it (puck_data + derived resume_content); SEND freezes the draft into
// an application (auto-issued code + rendered PDF) and returns to /admin/drafts.
// docs/design/resume-composer-puck.md (Q0 cutover).

'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import type { Data } from '@measured/puck';

import {
  PuckResumeEditor, puckInitialData, deriveModel,
} from '@/components/admin/composer/PuckResumeEditor';
import { ComposerCodeContext } from '@/lib/admin/composer-code-context';
import { savePuckDraft, previewURL } from '@/lib/admin/save-draft';
import { commitDraft } from '@/lib/admin/commit-draft';
import { useComposerCode, type ComposerCode } from '@/lib/admin/use-composer-code';
import { useAction } from '@/lib/ui/use-action';
import { jsonEqual } from '@/lib/json-equal';
import { draftToAPIContent, type DraftModel } from '@/lib/admin/draft-model';
import type { CodeView } from '@/lib/admin/use-codes';

// contentOf —— the derived, canonical resume_content the current Puck doc would SAVE. Dirty state
// compares this against the last-saved content (recursive value compare), not the raw puck_data:
// Puck adds structural noise (ids/zones) on edit that never round-trips back to the untouched doc,
// so comparing puck_data would stay dirty forever after one keystroke. The derived content is
// normalized (fromPuckData drops that noise), so undoing an edit back to the saved value reads clean.
function contentOf(model: DraftModel, d: Data): unknown {
  return draftToAPIContent(deriveModel(model, d));
}

export function PuckComposer({ model, initialPuckData }: {
  model: DraftModel;
  initialPuckData: unknown;
}) {
  const tJobs = useTranslations('adminJobs');
  const router = useRouter();
  const run = useAction();
  const code = useComposerCode();
  const [initial] = useState<Data>(() => puckInitialData(model, initialPuckData));
  const latest = useRef<Data>(initial);
  const baseline = useRef<unknown>(draftToAPIContent(model)); // last-saved resume_content
  const [dirty, setDirty] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [discard, setDiscard] = useState(false);

  const onData = useCallback((d: Data) => {
    latest.current = d;
    setDirty(!jsonEqual(contentOf(model, d), baseline.current)); // value compare of the saved shape
  }, [model]);

  // Native guard for tab-close / refresh / hard navigation while there are unsaved edits.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent): void => { e.preventDefault(); e.returnValue = ''; };
    dirty && window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const markSaved = useCallback((data: Data): void => {
    baseline.current = contentOf(model, data); setDirty(false);
  }, [model]);
  const save = useCallback(() => {
    const data = latest.current;
    void savePuckDraft(deriveModel(model, data), data).then(() => markSaved(data)).catch(() => undefined);
  }, [model, markSaved]);

  const leaveToDrafts = (): void => { router.push('/admin/drafts'); };
  // Leaving with unsaved edits asks first (the discard modal); a clean editor leaves straight away.
  const back = (): void => (dirty ? setDiscard(true) : leaveToDrafts());

  const send = (): void => {
    setConfirm(false);
    // Default = auto-issue a fresh code (the confirm's promise); reuse an existing one only when the
    // owner picked it. mode 'existing' with an empty code is ErrCodeNotUsable (400).
    const choice = code.codeId === ''
      ? { mode: 'new' as const, codeId: '' }
      : { mode: 'existing' as const, codeId: code.codeId };
    void run(async () => {
      // Persist the current edit first so the committed PDF matches what's on screen, then freeze.
      await savePuckDraft(deriveModel(model, latest.current), latest.current);
      const committed = await commitDraft(model.id, choice);
      markSaved(latest.current); // committed → nothing left to discard on the way out
      router.push('/admin/drafts');
      return committed;
    }, { success: tJobs('drafts.committed') });
  };

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)]" data-testid="puck-composer">
      <ComposerBar model={model} dirty={dirty} onBack={back} onSave={save} onSend={() => setConfirm(true)} />
      <ComposerCanvas code={code} initial={initial} onData={onData} />
      {confirm && (
        <ConfirmSend
          model={model} code={code.selectedCode}
          onCancel={() => setConfirm(false)} onSend={send}
        />
      )}
      {discard && (
        <DiscardModal
          onKeep={() => setDiscard(false)}
          onDiscard={() => { setDiscard(false); leaveToDrafts(); }}
        />
      )}
    </div>
  );
}

// ComposerCanvas —— the Puck editor, wrapped in the code-selection context so the picker inside the
// Header component's field panel reads/writes the composer's chosen code (the QR is a Header element).
function ComposerCanvas({ code, initial, onData }: {
  code: ComposerCode; initial: Data; onData: (d: Data) => void;
}) {
  return (
    <ComposerCodeContext.Provider
      value={{ activeCodes: code.activeCodes, codeId: code.codeId, setCodeId: code.setCodeId }}
    >
      <div className="flex-1 min-h-0">
        <PuckResumeEditor initial={initial} onData={onData} />
      </div>
    </ComposerCodeContext.Provider>
  );
}

function ComposerBar({
  model, dirty, onBack, onSave, onSend,
}: {
  model: DraftModel; dirty: boolean; onBack: () => void; onSave: () => void; onSend: () => void;
}) {
  const t = useTranslations('adminShell.composer');
  return (
    <header className="flex items-center justify-between gap-3 px-4 py-2 border-b border-(--color-rule)">
      <button type="button" onClick={onBack} className="mono text-[11px] tracking-[0.14em] uppercase text-(--color-muted) hover:text-(--color-ink) bg-transparent" data-testid="composer-back">
        {t('backToDrafts')}
      </button>
      <div className="flex items-center gap-3">
        <a href={previewURL(model.id, Date.now())} target="_blank" rel="noreferrer" className="mono text-[11px] tracking-[0.06em] text-(--color-muted) hover:text-(--color-ink)" data-testid="composer-preview">
          {t('previewPdf')}
        </a>
        <button type="button" onClick={onSave} className="sm-btn sm-btn-outline sm-btn-sm inline-flex items-center gap-1.5" data-testid="puck-save" data-dirty={dirty}>
          {dirty ? <span className="w-1.5 h-1.5 rounded-full bg-(--color-accent)" aria-hidden="true" /> : null}
          {t('save')}
        </button>
        <button type="button" onClick={onSend} className="sm-btn sm-btn-solid sm-btn-sm" data-testid="composer-send">
          {t('send')}
        </button>
      </div>
    </header>
  );
}

// DiscardModal —— leaving the composer with unsaved edits asks before dropping them. Same modal
// language as the send confirm. (Tab-close / refresh is guarded natively by beforeunload above.)
function DiscardModal({ onKeep, onDiscard }: { onKeep: () => void; onDiscard: () => void }) {
  const t = useTranslations('adminShell.composer');
  return (
    <div className="sm-fadein sm-composer-confirm-overlay" onClick={onKeep}>
      <div className="sm-composer-confirm-card sm-rise" onClick={(e) => e.stopPropagation()} data-testid="discard-modal">
        <div className="sm-smallcaps">{t('discardTitle')}</div>
        <p className="sm-reading text-(--color-muted) text-[14.5px] mt-2">{t('discardBody')}</p>
        <div className="flex items-center justify-end gap-3 mt-5">
          <button type="button" onClick={onKeep} className="sm-btn sm-btn-ghost" data-testid="discard-keep">{t('keepEditing')}</button>
          <button type="button" onClick={onDiscard} className="sm-btn sm-btn-accent" data-testid="discard-leave">{t('discardLeave')}</button>
        </div>
      </div>
    </div>
  );
}

function ConfirmSend({
  model, code, onCancel, onSend,
}: { model: DraftModel; code: CodeView | undefined; onCancel: () => void; onSend: () => void }) {
  const t = useTranslations('adminShell.composer');
  return (
    <div className="sm-fadein sm-composer-confirm-overlay" onClick={onCancel}>
      <div className="sm-composer-confirm-card sm-rise" onClick={(e) => e.stopPropagation()}>
        <div className="sm-smallcaps">{t('freezeAndSend')}</div>
        <h3 className="font-serif text-[22px] text-(--color-ink) font-normal mt-1.5">
          {t('confirmTitle', { company: model.company })}
        </h3>
        <p className="sm-reading text-(--color-muted) text-[14.5px] mt-2">{t('confirmBody')}</p>
        <p className="mono text-[11px] text-(--color-muted) mt-3" data-testid="composer-confirm-code">
          {code ? `${code.label} · ${code.code}` : t('codeNone')}
        </p>
        <div className="flex items-center justify-end gap-3 mt-5">
          <button type="button" onClick={onCancel} className="sm-btn sm-btn-ghost">{t('keepEditing')}</button>
          <button type="button" onClick={onSend} className="sm-btn sm-btn-accent" data-testid="composer-confirm-send">
            {t('send')}
          </button>
        </div>
      </div>
    </div>
  );
}
