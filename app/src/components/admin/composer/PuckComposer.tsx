// PuckComposer —— the full-page résumé composer (owner-chosen layout A): a top action bar
// (← drafts · Save · code▾ · preview PDF ↗ · SEND) over the full-page Puck editor. Puck owns the
// editor state; Save persists it (puck_data + derived resume_content); SEND freezes the draft into
// an application (auto-issued code + rendered PDF) and returns to /admin/drafts.
// docs/design/resume-composer-puck.md (Q0 cutover).

'use client';

import { useState, useRef, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import type { Data } from '@measured/puck';

import {
  PuckResumeEditor, puckInitialData, deriveModel,
} from '@/components/admin/composer/PuckResumeEditor';
import { SelectField } from '@/components/atoms/SelectField';
import { savePuckDraft, previewURL } from '@/lib/admin/save-draft';
import { commitDraft } from '@/lib/admin/commit-draft';
import { useComposerCode } from '@/lib/admin/use-composer-code';
import { useAction } from '@/lib/ui/use-action';
import type { DraftModel } from '@/lib/admin/draft-model';
import type { CodeView } from '@/lib/admin/use-codes';

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
  const [confirm, setConfirm] = useState(false);
  const onData = useCallback((d: Data) => { latest.current = d; }, []);

  const save = useCallback(() => {
    void savePuckDraft(deriveModel(model, latest.current), latest.current);
  }, [model]);

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
      router.push('/admin/drafts');
      return committed;
    }, { success: tJobs('drafts.committed') });
  };

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)]" data-testid="puck-composer">
      <ComposerBar
        model={model} onSave={save} onSend={() => setConfirm(true)}
        codes={code.activeCodes} codeId={code.codeId} onCode={code.setCodeId}
      />
      <div className="flex-1 min-h-0">
        <PuckResumeEditor initial={initial} onData={onData} />
      </div>
      {confirm && (
        <ConfirmSend
          model={model} code={code.selectedCode}
          onCancel={() => setConfirm(false)} onSend={send}
        />
      )}
    </div>
  );
}

function ComposerBar({
  model, onSave, onSend, codes, codeId, onCode,
}: {
  model: DraftModel; onSave: () => void; onSend: () => void;
  codes: readonly CodeView[]; codeId: string; onCode: (id: string) => void;
}) {
  const t = useTranslations('adminShell.composer');
  return (
    <header className="flex items-center justify-between gap-3 px-4 py-2 border-b border-(--color-rule)">
      <a href="/admin/drafts" className="mono text-[11px] tracking-[0.14em] uppercase text-(--color-muted) hover:text-(--color-ink)" data-testid="composer-back">
        {t('backToDrafts')}
      </a>
      <div className="flex items-center gap-3">
        <CodeSelect codes={codes} codeId={codeId} onCode={onCode} />
        <a href={previewURL(model.id, Date.now())} target="_blank" rel="noreferrer" className="mono text-[11px] tracking-[0.06em] text-(--color-muted) hover:text-(--color-ink)" data-testid="composer-preview">
          {t('previewPdf')}
        </a>
        <button type="button" onClick={onSave} className="sm-btn sm-btn-outline sm-btn-sm" data-testid="puck-save">
          {t('save')}
        </button>
        <button type="button" onClick={onSend} className="sm-btn sm-btn-solid sm-btn-sm" data-testid="composer-send">
          {t('send')}
        </button>
      </div>
    </header>
  );
}

function CodeSelect({
  codes, codeId, onCode,
}: { codes: readonly CodeView[]; codeId: string; onCode: (id: string) => void }) {
  const t = useTranslations('adminShell.composer');
  return codes.length === 0
    ? <span className="mono text-[10px] text-(--color-faint)" data-testid="composer-code-empty">{t('codeNone')}</span>
    : (
      <SelectField testid="composer-code-select" aria-label="access code" value={codeId} onChange={(e) => onCode(e.target.value)} mono>
        {codes.map((c) => <option key={c.id} value={c.id}>{c.label} · {c.code}</option>)}
      </SelectField>
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
