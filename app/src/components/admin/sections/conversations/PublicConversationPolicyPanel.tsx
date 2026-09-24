// PublicConversationPolicyPanel —— how codeless (public/byoai) conversations are kept, above the
// conversations table. Public chat is open to anyone, so its records can pile up: the owner can
// stop saving them at all, and/or prune idle ones on a cron. Coded conversations are never
// affected. Defaults: saved, no prune.

'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { Toggle } from '@/components/atoms/Toggle';
import {
  usePublicConversationPolicy, type PolicyInput, type PublicConversationPolicy,
} from '@/lib/admin/use-public-conversation-policy';
import { useAction } from '@/lib/ui/use-action';

export function PublicConversationPolicyPanel() {
  const { data, save } = usePublicConversationPolicy();
  // Keyed on the stored values so the form re-seeds from what the server returned after a save.
  return data === null ? null : (
    <PolicyForm key={`${data.prune_cron}|${data.retention_days}`} data={data} save={save} />
  );
}

interface FormProps {
  data: PublicConversationPolicy;
  save: (next: PolicyInput) => Promise<void>;
}

function PolicyForm({ data, save }: FormProps) {
  const t = useTranslations('adminAccess.conversationPrune');
  const run = useAction();
  return (
    <div
      data-testid="conv-policy-panel"
      title={t('help')}
      className="mb-5 border border-(--color-rule) rounded-sm bg-(--color-surface)/20 px-3 py-2.5"
    >
      <div className="flex items-center justify-between gap-3 mb-2">
        <span className="mono text-[9.5px] tracking-[0.2em] uppercase text-(--color-muted)">
          {t('title')}
        </span>
        <span className="flex items-center gap-2 mono text-[10px] text-(--color-muted)">
          {t('saveLabel')}
          <Toggle
            on={data.save}
            onToggle={() => void run(() => save({ ...data, save: !data.save }), { success: t('saved') })}
            label={t('saveLabel')}
            testid="conv-policy-save-toggle"
          />
        </span>
      </div>
      <PruneRow data={data} save={save} />
      <PolicyStatus data={data} />
    </div>
  );
}

function PruneRow({ data, save }: FormProps) {
  const t = useTranslations('adminAccess.conversationPrune');
  const [cron, setCron] = useState(data.prune_cron);
  const [days, setDays] = useState(String(data.retention_days));
  const run = useAction();
  const n = parseInt(days, 10);
  const canSave = isSavable(data, cron.trim(), n);
  return (
    <div className="flex flex-wrap items-baseline gap-2">
      <input
        type="text"
        data-testid="conv-prune-cron"
        value={cron}
        onChange={(e) => setCron(e.target.value)}
        placeholder="@daily"
        aria-label={t('cronLabel')}
        className="sm-field-input sm-mono sm-field-xs w-32"
      />
      <input
        type="number"
        min={1}
        inputMode="numeric"
        data-testid="conv-prune-days"
        value={days}
        onChange={(e) => setDays(e.target.value)}
        aria-label={t('daysLabel')}
        className="sm-field-input sm-mono sm-field-xs w-20"
      />
      <span className="mono text-[10px] text-(--color-faint)">{t('days')}</span>
      <button
        type="button"
        disabled={!canSave}
        data-testid="conv-prune-save"
        onClick={() => void run(
          () => save({ save: data.save, prune_cron: cron.trim(), retention_days: n }),
          { success: t('saved') },
        )}
        className="mono text-[10px] tracking-[0.14em] uppercase text-(--color-muted) hover:text-(--color-ink) disabled:opacity-40"
      >
        {t('save')}
      </button>
    </div>
  );
}

// isSavable —— at least a day of retention (NaN fails too), and something actually changed.
function isSavable(data: PublicConversationPolicy, cron: string, days: number): boolean {
  return days >= 1 && (cron !== data.prune_cron || days !== data.retention_days);
}

// PolicyStatus —— what is stored now (not the form's draft).
function PolicyStatus({ data }: { data: PublicConversationPolicy }) {
  const t = useTranslations('adminAccess.conversationPrune');
  return (
    <p data-testid="conv-prune-status" className="mono text-[10.5px] text-(--color-faint) mt-2">
      {data.save ? '' : `${t('notSaved')} · `}
      {data.prune_cron === ''
        ? t('off')
        : t('on', { cron: data.prune_cron, days: data.retention_days })}
    </p>
  );
}
