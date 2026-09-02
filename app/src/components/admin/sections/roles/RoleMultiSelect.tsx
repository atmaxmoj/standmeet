// RoleMultiSelect —— a row of checkable chips: both of a role's **tool-grant lists**
// (skills / external MCP servers) use it.
//
// It used to be a private component of RoleCreateModal, so these two lists **were settable
// only at role-creation time**. Once the role existed, the card kept only the two read-only
// lines `SKILLS 0` / `MCP 0 servers` — and `invited` and `public` are seeder-created, never
// went through that modal, so they could never get any external MCP server attached
// (F-D-9).
//
// Extracted so the card editors can **reuse the same control** instead of copying it again:
// one control, two call sites, so the chip's testid, empty-state text, and check semantics
// live in exactly one place.

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
