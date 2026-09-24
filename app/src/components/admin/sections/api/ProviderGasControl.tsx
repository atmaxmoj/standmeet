// ProviderGasControl — set this provider's token budget and (for a metered tank) its auto-refill
// schedule. Gas is NOT money: it's a self-set cap on how many tokens this provider may spend per
// period; the cron re-opens it on schedule, and when it's spent visitors are asked for a code or
// their own key. A hover tooltip says exactly that, because "budget/refill" is not obvious at a
// glance (the old "充值/recharge" wording read as topping up a paid balance — it isn't).

'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

import type { ProviderView } from '@/lib/admin/use-providers';
import { useAction } from '@/lib/ui/use-action';

interface GasProps {
  row: ProviderView;
  setGas: (id: string, tokens: number | null) => Promise<void>;
  setRefillCron: (id: string, cron: string) => Promise<void>;
}

export function ProviderGasControl({ row, setGas, setRefillCron }: GasProps) {
  const t = useTranslations('adminIntegrations.providerBook');
  const [text, setText] = useState('');
  const run = useAction();
  const tokens = parseInt(text.trim(), 10);
  const budgetable = Number.isFinite(tokens) && tokens > 0;
  return (
    <div className="flex flex-wrap items-baseline gap-2 pl-1" title={t('gasHelp')}>
      <input
        type="number"
        min={1}
        inputMode="numeric"
        data-testid={`provider-gas-input-${row.label}`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t('gasFillPlaceholder')}
        className="sm-field-input sm-mono sm-field-xs w-28"
      />
      <button
        type="button"
        disabled={!budgetable}
        data-testid={`provider-gas-fill-${row.label}`}
        onClick={() => void run(
          async () => { await setGas(row.id, tokens); setText(''); },
          { success: t('gasFilled') },
        )}
        className="mono text-[10px] tracking-[0.14em] uppercase text-(--color-muted) hover:text-(--color-ink) disabled:opacity-40"
      >
        {t('gasFill')}
      </button>
      {row.gas_tokens !== null && <RefillControls row={row} setGas={setGas} setRefillCron={setRefillCron} />}
    </div>
  );
}

// RefillControls — only meaningful for a metered tank: its auto-refill schedule + the meter switch.
function RefillControls({ row, setGas, setRefillCron }: GasProps) {
  const t = useTranslations('adminIntegrations.providerBook');
  const [cron, setCron] = useState(row.gas_refill_cron);
  const run = useAction();
  const cronDirty = cron.trim() !== row.gas_refill_cron;
  return (
    <>
      <input
        type="text"
        data-testid={`provider-refill-cron-input-${row.label}`}
        value={cron}
        onChange={(e) => setCron(e.target.value)}
        placeholder="0 0 * * *"
        title={t('gasHelp')}
        className="sm-field-input sm-mono sm-field-xs w-32"
      />
      <button
        type="button"
        disabled={!cronDirty}
        data-testid={`provider-refill-cron-set-${row.label}`}
        onClick={() => void run(() => setRefillCron(row.id, cron.trim()), { success: t('gasRefillSaved') })}
        className="mono text-[10px] tracking-[0.14em] uppercase text-(--color-muted) hover:text-(--color-ink) disabled:opacity-40"
      >
        {t('gasRefillSet')}
      </button>
      <button
        type="button"
        data-testid={`provider-gas-unmeter-${row.label}`}
        onClick={() => void run(() => setGas(row.id, null), { success: t('gasUnmetered') })}
        className="mono text-[10px] tracking-[0.14em] uppercase text-(--color-faint) hover:text-(--color-accent)"
      >
        {t('gasUnmeter')}
      </button>
    </>
  );
}
