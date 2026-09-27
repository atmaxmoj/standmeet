// CodeSearchField —— the search box above every code picker: the shared PickerSearchField with
// the codes wording.

'use client';

import { useTranslations } from 'next-intl';

import { PickerSearchField } from '@/components/admin/PickerSearchField';

export function CodeSearchField({ value, onChange, testid }: {
  value: string; onChange: (q: string) => void; testid: string;
}) {
  const t = useTranslations('adminAccess');
  return (
    <PickerSearchField
      value={value} onChange={onChange} testid={testid} placeholder={t('codes.searchPlaceholder')}
    />
  );
}
