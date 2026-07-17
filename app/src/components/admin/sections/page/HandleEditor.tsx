// HandleEditor —— /admin/page · site block 里的"URL handle"行。
// 默认显示当前 handle + 一个 change 按钮；点开是 inline 输入框 +
// hint + save/cancel。保存成功后 onChanged 让父级更新本地 handle，
// 老 handle 仍由 backend handle_aliases 自动 resolve。

'use client';

import { useState } from 'react';

import { useTranslations } from 'next-intl';

import {
  useHandle, sanitizeHandle, handleHint, canSaveHandle, commitHandle,
  type HandleHook,
} from '@/lib/admin/use-handle';
import { useEffectErrorToast, useToast } from '@/lib/ui/toast';

type Props = { current: string; onChanged: (h: string) => void };

export function HandleEditor({ current, onChanged }: Props) {
  const [editing, setEditing] = useState(false);
  return editing
    ? <EditingRow current={current} onChanged={onChanged} onClose={() => setEditing(false)} />
    : <DisplayRow current={current} onEdit={() => setEditing(true)} />;
}

function DisplayRow({ current, onEdit }: { current: string; onEdit: () => void }) {
  const t = useTranslations('adminPages.handle');
  return (
    <div className="flex items-baseline gap-3 flex-wrap" data-testid="handle-display">
      <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted)">
        {t('label')}
      </span>
      <span className="font-serif text-(--color-ink) text-[18px] font-medium tracking-[-0.005em]">
        @<span className="text-(--color-accent)">{current}</span>
      </span>
      <ChangeBtn onClick={onEdit} />
    </div>
  );
}

function ChangeBtn({ onClick }: { onClick: () => void }) {
  const t = useTranslations('adminPages.handle');
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid="handle-change-btn"
      className="mono text-[10px] tracking-[0.16em] uppercase text-(--color-muted) hover:text-(--color-accent)"
    >
      {t('change')} ↗
    </button>
  );
}

function EditingRow({
  current, onChanged, onClose,
}: { current: string; onChanged: (h: string) => void; onClose: () => void }) {
  const [raw, setRaw] = useState(current);
  const handle = useHandle();
  const sanitized = sanitizeHandle(raw);
  useEffectErrorToast(handle.error);
  return (
    <div className="space-y-2" data-testid="handle-editor">
      <div className="flex items-baseline gap-2 border-b border-(--color-rule) pb-1">
        <span className="mono text-(--color-faint)">@</span>
        <input
          type="text"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          autoFocus
          spellCheck={false}
          autoComplete="off"
          data-testid="handle-input"
          className="flex-1 min-w-0 bg-transparent py-1.5 reading-tight text-[17px] font-medium tracking-[-0.005em]"
        />
        <CancelBtn onClick={onClose} disabled={handle.pending} />
      </div>
      <EditFootRow
        current={current} sanitized={sanitized} hook={handle}
        onChanged={onChanged} onClose={onClose}
      />
    </div>
  );
}

function CancelBtn({ onClick, disabled }: { onClick: () => void; disabled: boolean }) {
  const t = useTranslations('adminPages.handle');
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="mono text-[10px] tracking-[0.12em] text-(--color-faint) hover:text-(--color-accent) disabled:opacity-50"
    >
      {t('cancel')}
    </button>
  );
}

function EditFootRow({
  current, sanitized, hook, onChanged, onClose,
}: {
  current: string;
  sanitized: string;
  hook: HandleHook;
  onChanged: (h: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="mono text-[10.5px] tracking-[0.04em] flex items-baseline justify-between gap-3 flex-wrap">
      <HintLine sanitized={sanitized} current={current} error={hook.error} />
      <SaveBtn
        sanitized={sanitized} current={current} hook={hook}
        onChanged={onChanged} onClose={onClose}
      />
    </div>
  );
}

function HintLine({
  sanitized, current, error,
}: { sanitized: string; current: string; error: string | null }) {
  const hint = handleHint(sanitized, current);
  return error
    ? <span className="text-(--color-accent)" data-testid="handle-error">{error}</span>
    : <span className={hint.cls} data-testid="handle-hint">{hint.text}</span>;
}

function SaveBtn({
  sanitized, current, hook, onChanged, onClose,
}: {
  sanitized: string;
  current: string;
  hook: HandleHook;
  onChanged: (h: string) => void;
  onClose: () => void;
}) {
  const ready = canSaveHandle(sanitized, current, hook.pending);
  const toast = useToast();
  const onSuccess = (h: string) => toast.success(`Handle updated to /${h}`);
  return (
    <button
      type="button"
      onClick={() => void commitHandle(sanitized, hook, onChanged, onClose, onSuccess)}
      disabled={!ready}
      data-testid="handle-save-btn"
      className="mono text-[10px] tracking-[0.16em] uppercase text-(--color-paper) bg-(--color-ink) px-2.5 py-1 hover:bg-(--color-accent) transition-colors disabled:opacity-40"
    >
      {hook.pending ? 'saving…' : 'save handle'}
    </button>
  );
}
