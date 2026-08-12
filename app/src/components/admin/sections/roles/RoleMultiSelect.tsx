// RoleMultiSelect —— 一排可勾的 chip：role 的两份**工具授权清单**（skills / 外部 MCP
// servers）都用它。
//
// 它原来是 RoleCreateModal 的私有组件，于是这两份清单**只在建角色那一刻能设**。角色建好
// 之后卡片上只剩 `SKILLS 0` / `MCP 0 servers` 两行只读文字 —— 而 `invited` 和 `public`
// 是 seeder 建的，从没经过那个弹窗，也就永远挂不上任何一台外部 MCP server（F-D-9）。
//
// 抽出来是为了让卡片编辑器**复用同一个控件**而不是再抄一份：一个控件两个调用点，
// chip 的 testid、空态那句话、勾选语义只有一处。

'use client';

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';

export interface RoleMultiOption {
  id: string;
  label: string;
}

export function RoleMultiSelect({
  label, options, value, onChange, testid,
}: {
  label: string;
  options: readonly RoleMultiOption[];
  value: string[];
  onChange: (v: string[]) => void;
  testid: string;
}) {
  const t = useTranslations('adminAccess');
  const toggle = useCallback((id: string) => {
    onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  }, [value, onChange]);
  return (
    <fieldset className="flex flex-col gap-1.5" data-testid={testid}>
      <legend className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted)">
        {label}
      </legend>
      {options.length === 0 && (
        <p className="mono text-[10.5px] text-(--color-faint) italic">{t('roleCreate.noneConfigured')}</p>
      )}
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <RoleMultiSelectChip
            key={o.id}
            option={o}
            selected={value.includes(o.id)}
            onToggle={() => toggle(o.id)}
          />
        ))}
      </div>
    </fieldset>
  );
}

function RoleMultiSelectChip({
  option, selected, onToggle,
}: {
  option: RoleMultiOption;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      data-testid={`role-multi-${option.label}`}
      className={`mono text-[10.5px] tracking-[0.10em] uppercase px-2.5 py-1 border ${
        selected
          ? 'bg-(--color-ink) text-(--color-paper) border-(--color-ink)'
          : 'border-(--color-rule) text-(--color-muted) hover:border-(--color-ink)'
      }`}
    >
      {option.label}
    </button>
  );
}
