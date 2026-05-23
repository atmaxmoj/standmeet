// PublicURLEditor —— /admin/page · site block 里的"public URL"行。
// owner.public_url 是 instance 部署的 canonical 入口；QR / SEO canonical /
// 简历右上角二维码全用它。claim 时填了一次，部署到新域名后从这里改。
//
// 跟 HandleEditor 同构：默认显示当前值 + change 按钮；点开 inline 输入框。

'use client';

import { useState } from 'react';

import {
  usePublicURL, sanitizePublicURL, publicURLHint,
  canSavePublicURL, commitPublicURL,
  type PublicURLHook,
} from '@/lib/admin/use-public-url';
import { useEffectErrorToast, useToast } from '@/lib/ui/toast';

type Props = { current: string; onChanged: (u: string) => void };

export function PublicURLEditor({ current, onChanged }: Props) {
  const [editing, setEditing] = useState(false);
  return editing
    ? <EditingRow current={current} onChanged={onChanged} onClose={() => setEditing(false)} />
    : <DisplayRow current={current} onEdit={() => setEditing(true)} />;
}

function DisplayRow({ current, onEdit }: { current: string; onEdit: () => void }) {
  return (
    <div className="flex items-baseline gap-3 flex-wrap" data-testid="public-url-display">
      <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted)">
        public URL
      </span>
      <span className="font-serif text-(--color-ink) text-[18px] font-medium tracking-[-0.005em]">
        {current || <em className="text-(--color-faint)">unset</em>}
      </span>
      <ChangeBtn onClick={onEdit} />
    </div>
  );
}

function ChangeBtn({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid="public-url-change-btn"
      className="mono text-[10px] tracking-[0.16em] uppercase text-(--color-muted) hover:text-(--color-accent)"
    >
      change ↗
    </button>
  );
}

function EditingRow({
  current, onChanged, onClose,
}: { current: string; onChanged: (u: string) => void; onClose: () => void }) {
  const [raw, setRaw] = useState(current);
  const hook = usePublicURL();
  const sanitized = sanitizePublicURL(raw);
  useEffectErrorToast(hook.error);
  return (
    <div className="space-y-2" data-testid="public-url-editor">
      <div className="flex items-baseline gap-2 border-b border-(--color-rule) pb-1">
        <input
          type="text"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          autoFocus
          spellCheck={false}
          autoComplete="off"
          placeholder="https://yourdomain.com"
          data-testid="public-url-input"
          className="flex-1 min-w-0 bg-transparent py-1.5 reading-tight text-[17px] font-medium tracking-[-0.005em]"
        />
        <CancelBtn onClick={onClose} disabled={hook.pending} />
      </div>
      <EditFootRow
        current={current} sanitized={sanitized} hook={hook}
        onChanged={onChanged} onClose={onClose}
      />
    </div>
  );
}

function CancelBtn({ onClick, disabled }: { onClick: () => void; disabled: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="mono text-[10px] tracking-[0.12em] text-(--color-faint) hover:text-(--color-accent) disabled:opacity-50"
    >
      cancel
    </button>
  );
}

function EditFootRow({
  current, sanitized, hook, onChanged, onClose,
}: {
  current: string;
  sanitized: string;
  hook: PublicURLHook;
  onChanged: (u: string) => void;
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
  const hint = publicURLHint(sanitized, current);
  return error
    ? <span className="text-(--color-accent)" data-testid="public-url-error">{error}</span>
    : <span className={hint.cls} data-testid="public-url-hint">{hint.text}</span>;
}

function SaveBtn({
  sanitized, current, hook, onChanged, onClose,
}: {
  sanitized: string;
  current: string;
  hook: PublicURLHook;
  onChanged: (u: string) => void;
  onClose: () => void;
}) {
  const ready = canSavePublicURL(sanitized, current, hook.pending);
  const toast = useToast();
  const onSuccess = (u: string) => toast.success(`Public URL updated to ${u}`);
  return (
    <button
      type="button"
      onClick={() => void commitPublicURL(sanitized, hook, onChanged, onClose, onSuccess)}
      disabled={!ready}
      data-testid="public-url-save-btn"
      className="mono text-[10px] tracking-[0.16em] uppercase text-(--color-paper) bg-(--color-ink) px-2.5 py-1 hover:bg-(--color-accent) transition-colors disabled:opacity-40"
    >
      {hook.pending ? 'saving…' : 'save URL'}
    </button>
  );
}
