// ProviderGasControl — top off a fuel tank, or tear the gauge off.
//
// Filling records "how much was added this time", and the baseline moves
// with it — so right after filling, the reading is exactly what was added,
// not eaten by whatever was already spent before. Tearing the gauge off
// (unmeter) means this provider is no longer metered; roles attached to it
// still work as before.

'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

import type { ProviderView } from '@/lib/admin/use-providers';
import { useAction } from '@/lib/ui/use-action';

export function ProviderGasControl({
  row, setGas,
}: {
  row: ProviderView;
  setGas: (id: string, tokens: number | null) => Promise<void>;
}) {
  const t = useTranslations('adminIntegrations.providerBook');
  const [text, setText] = useState('');
  const run = useAction();
  const tokens = parseInt(text.trim(), 10);
  const fillable = Number.isFinite(tokens) && tokens > 0;
  return (
    <div className="flex items-baseline gap-2 pl-1">
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
        disabled={!fillable}
        data-testid={`provider-gas-fill-${row.label}`}
        onClick={() => void run(
          async () => { await setGas(row.id, tokens); setText(''); },
          { success: t('gasFilled') },
        )}
        className="mono text-[10px] tracking-[0.14em] uppercase text-(--color-muted) hover:text-(--color-ink) disabled:opacity-40"
      >
        {t('gasFill')}
      </button>
      {row.gas_tokens !== null && (
        <button
          type="button"
          data-testid={`provider-gas-unmeter-${row.label}`}
          onClick={() => void run(() => setGas(row.id, null), { success: t('gasUnmetered') })}
          className="mono text-[10px] tracking-[0.14em] uppercase text-(--color-faint) hover:text-(--color-accent)"
        >
          {t('gasUnmeter')}
        </button>
      )}
    </div>
  );
}
