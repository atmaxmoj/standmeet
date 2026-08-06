// ProviderBookRow —— 本子里的一条。
//
// 默认那条给徽章不给按钮:它已经是默认了,而且删不掉(后端 409)。其余每条两个动作:
// 标默认 / 删。删的那句"这是默认那条"由后端说 —— 前端不复述规则,免得两处各说一套。

'use client';

import { useTranslations } from 'next-intl';

import type { ProviderView } from '@/lib/admin/use-providers';
import { useAction } from '@/lib/ui/use-action';

interface Props {
  row: ProviderView;
  setDefault: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export function ProviderBookRow({ row, setDefault, remove }: Props) {
  return (
    <li
      data-testid={`provider-row-${row.label}`}
      className="flex items-baseline gap-4 py-2 border-b border-(--color-rule)/60"
    >
      <Identity row={row} />
      <KeyState configured={row.key_configured} />
      <Actions row={row} setDefault={setDefault} remove={remove} />
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
