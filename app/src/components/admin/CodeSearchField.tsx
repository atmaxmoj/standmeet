// CodeSearchField —— the search box above every code picker. A picker offers the newest page of
// active codes; typing narrows on the server (docs/design/paging.md, *Pickers*), so a code on
// "page 7" is one search away instead of unreachable.

'use client';

import { useTranslations } from 'next-intl';

export function CodeSearchField({ value, onChange, testid }: {
  value: string; onChange: (q: string) => void; testid: string;
}) {
  const t = useTranslations('adminAccess');
  return (
    <input
      type="search" value={value} onChange={(e) => onChange(e.target.value)}
      placeholder={t('codes.searchPlaceholder')} aria-label={t('codes.searchPlaceholder')}
      data-testid={testid} className="sm-field-input w-full mb-2"
    />
  );
}
