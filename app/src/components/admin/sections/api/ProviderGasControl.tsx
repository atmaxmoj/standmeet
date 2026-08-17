// ProviderGasControl —— 给一箱油加油,或者把表拆了。
//
// 加油写的是"这一箱加了多少",起算点跟着一起挪 —— 所以加满之后读数就是加的那个数,
// 而不是被之前花掉的量吃掉。拆表(unmeter)= 这条 provider 不再计量,挂着表的 role 也照发。

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
