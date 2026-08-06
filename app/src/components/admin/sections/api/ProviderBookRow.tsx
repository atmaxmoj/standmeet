// ProviderBookRow —— 本子里的一条。
//
// 默认那条给徽章不给按钮:它已经是默认了,而且删不掉(后端 409)。其余每条两个动作:
// 标默认 / 删。删的那句"这是默认那条"由后端说 —— 前端不复述规则,免得两处各说一套。

'use client';

import { useTranslations } from 'next-intl';

import { ProviderGasControl } from '@/components/admin/sections/api/ProviderGasControl';
import { formatTokens } from '@/lib/admin/format-tokens';
import type { ProviderView } from '@/lib/admin/use-providers';
import { useAction } from '@/lib/ui/use-action';

interface Props {
  row: ProviderView;
  setDefault: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

interface RowProps extends Props {
  setGas: (id: string, tokens: number | null) => Promise<void>;
}

// GasGauge —— 这箱油的读数。没挂表就是没挂表:不显示 "0",也不显示进度条 ——
// 绝大多数 owner 停在这一档,一个空油表会让人以为自己被限着。
function GasGauge({ row }: { row: ProviderView }) {
  const t = useTranslations('adminIntegrations.providerBook');
  return (
    <span
      data-testid={`provider-gas-${row.label}`}
      className="mono text-[10px] text-(--color-faint) whitespace-nowrap tabular-nums"
    >
      {row.gas_tokens === null
        ? t('gasUnmetered')
        : `${formatTokens(row.gas_remaining ?? 0)} / ${formatTokens(row.gas_tokens)}`}
    </span>
  );
}

export function ProviderBookRow({ row, setDefault, remove, setGas }: RowProps) {
  return (
    <li
      data-testid={`provider-row-${row.label}`}
      className="py-2 border-b border-(--color-rule)/60"
    >
      <div className="flex items-baseline gap-4">
        <Identity row={row} />
        <GasGauge row={row} />
        <KeyState configured={row.key_configured} />
        <Actions row={row} setDefault={setDefault} remove={remove} />
      </div>
      <ProviderGasControl row={row} setGas={setGas} />
    </li>
  );
}

function Identity({ row }: { row: ProviderView }) {
  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-baseline gap-2">
        <span className="reading-tight text-[15px] truncate">{row.label}</span>
        <DefaultBadge on={row.is_default} />
      </div>
      <div className="mono text-[10.5px] text-(--color-faint) truncate">
        {row.provider} · {row.model || '—'}
      </div>
    </div>
  );
}

function DefaultBadge({ on }: { on: boolean }) {
  const t = useTranslations('adminIntegrations.providerBook');
  return on ? (
    <span
      data-testid="provider-default-badge"
      className="mono text-[9.5px] tracking-[0.16em] uppercase text-(--color-paper) bg-(--color-ink) px-1.5 py-0.5"
    >
      {t('defaultBadge')}
    </span>
  ) : null;
}

function KeyState({ configured }: { configured: boolean }) {
  const t = useTranslations('adminIntegrations.providerBook');
  return (
    <span className="mono text-[10px] text-(--color-faint) whitespace-nowrap">
      {configured ? t('keySet') : t('keyUnset')}
    </span>
  );
}

function Actions({ row, setDefault, remove }: Props) {
  const t = useTranslations('adminIntegrations.providerBook');
  const run = useAction();
  return (
    <div className="flex items-baseline gap-3 whitespace-nowrap">
      {!row.is_default && (
        <button
          type="button"
          data-testid={`provider-make-default-${row.label}`}
          onClick={() => void run(() => setDefault(row.id), { success: t('defaultBadge') })}
          className="mono text-[10px] tracking-[0.14em] uppercase text-(--color-muted) hover:text-(--color-ink)"
        >
          {t('makeDefault')}
        </button>
      )}
      <button
        type="button"
        data-testid={`provider-delete-${row.label}`}
        onClick={() => void run(() => remove(row.id))}
        className="mono text-[10px] tracking-[0.14em] uppercase text-(--color-faint) hover:text-(--color-accent)"
      >
        {t('delete')}
      </button>
    </div>
  );
}
