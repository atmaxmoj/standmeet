// CodeRolePicker — the role dropdown inside the code create modal. A.3-IAM.
// Split out to keep CreateCodeFields.tsx under max-lines.
//
// The roles list pages (docs/design/paging.md): the dropdown offers the first page and a search
// narrows it on the server.

import { useTranslations } from 'next-intl';

import { PickerSearchField } from '@/components/admin/PickerSearchField';
import { SelectField } from '@/components/atoms/SelectField';
import { useRolePicker, type RolePicker } from '@/lib/admin/use-roles';
import type { CodeFormHook } from '@/lib/admin/use-code-form';

type Props = { form: CodeFormHook };

export function CodeRolePicker({ form }: Props) {
  const picker = useRolePicker();
  return (
    // The subtitle says **what happens if left blank**: the default is `invited`
    // (can read your curated corpus), because issuing a code is itself an invitation.
    // To grant only the public slice, pick `public` in the dropdown.
    <CodeRolePickerSection title="role" subtitle="frozen at issue; blank = invited">
      <CodeRolePickerSelect form={form} picker={picker} />
    </CodeRolePickerSection>
  );
}

function CodeRolePickerSelect({
  form, picker,
}: { form: CodeFormHook; picker: RolePicker }) {
  const t = useTranslations('adminShell.codeModal');
  const ta = useTranslations('adminAccess');
  return (
    <>
      <PickerSearchField
        value={picker.query} onChange={picker.setQuery} testid="code-field-role-search"
        placeholder={ta('roles.searchPlaceholder')}
      />
      <SelectField
        className="w-full"
        value={form.values.assumedRoleID}
        onChange={(e) => form.setAssumedRoleID(e.target.value)}
        testid="code-field-role"
      >
        <option value="">{t('roleDefault')}</option>
        {picker.page.items.map((r) => (
          <option key={r.id} value={r.id}>{r.name}</option>
        ))}
      </SelectField>
    </>
  );
}

function CodeRolePickerSection({
  title, subtitle, children,
}: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline gap-3">
        <h3 className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-ink)">{title}</h3>
        {subtitle && (
          <span className="mono text-[9.5px] text-(--color-faint)">{subtitle}</span>
        )}
      </div>
      {children}
    </div>
  );
}
