// ProviderSelect —— dropdown for "which provider to route through"; shared
// between access-code and role forms.
//
// Empty value = unspecified (a code inherits its role, a role falls back to
// the owner default). Options come from the owner's provider list
// (/admin/providers). The caller supplies the "inherit" copy — the two call
// sites resolve differently: a code resolves to its role, a role resolves to
// the default.

'use client';

import { SelectField } from '@/components/atoms/SelectField';
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
    <SelectField
      className="w-full"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      testid={testid}
    >
      <option value="">{inheritLabel}</option>
      {hook.providers.map((p) => (
        <option key={p.id} value={p.id}>{optionLabel(p)}</option>
      ))}
    </SelectField>
  );
}

// optionLabel —— label is the name the owner gave it, suffixed with the model:
// when two "work key" providers use different models, the dropdown must still
// tell them apart.
function optionLabel(p: ProviderView): string {
  return p.model === '' ? p.label : `${p.label} · ${p.model}`;
}
