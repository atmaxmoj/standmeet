// ProviderSelect —— "走哪条 provider" 的下拉,码和 role 共用一个。
//
// 空值 = 不指定(码继承 role,role 退 owner 默认)。选项来自 owner 的 provider 本子
// (/admin/providers)。inherit 那句由调用方给 —— 两处的落点不一样:码落到 role,role 落到默认。

'use client';

import { useProviders, type ProviderView } from '@/lib/admin/use-providers';

export function ProviderSelect({
  value, onChange, inheritLabel, testid,
}: {
  value: string;
  onChange: (v: string) => void;
  inheritLabel: string;
  testid: string;
}) {
  const hook = useProviders();
  return (
    <select
      className="border border-(--color-rule) px-3 py-2 bg-(--color-paper) text-[14px] w-full"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      data-testid={testid}
    >
      <option value="">{inheritLabel}</option>
      {hook.providers.map((p) => (
        <option key={p.id} value={p.id}>{optionLabel(p)}</option>
      ))}
    </select>
  );
}

// optionLabel —— label 是 owner 起的名,后面缀模型:两条 "work key" 用不同模型时,
// 下拉里得分得出哪条是哪条。
function optionLabel(p: ProviderView): string {
  return p.model === '' ? p.label : `${p.label} · ${p.model}`;
}
