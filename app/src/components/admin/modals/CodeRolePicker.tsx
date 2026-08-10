// CodeRolePicker —— code create modal 里的 role dropdown。A.3-IAM。
// 拆出来守 CreateCodeFields.tsx 的 max-lines。

import { useTranslations } from 'next-intl';

import { SelectField } from '@/components/atoms/SelectField';
import { useRoles, type RoleView } from '@/lib/admin/use-roles';
import type { CodeFormHook } from '@/lib/admin/use-code-form';

type Props = { form: CodeFormHook };

export function CodeRolePicker({ form }: Props) {
  const hook = useRoles();
  return (
    <CodeRolePickerSection title="role" subtitle="frozen at issue; leave blank for public">
      <CodeRolePickerSelect form={form} roles={hook.roles} />
    </CodeRolePickerSection>
  );
}

function CodeRolePickerSelect({
  form, roles,
}: { form: CodeFormHook; roles: readonly RoleView[] }) {
  const t = useTranslations('adminShell.codeModal');
  return (
    <SelectField
      className="w-full"
      value={form.values.assumedRoleID}
      onChange={(e) => form.setAssumedRoleID(e.target.value)}
      testid="code-field-role"
    >
      <option value="">{t('roleDefault')}</option>
      {roles.map((r) => (
        <option key={r.id} value={r.id}>{r.name}</option>
      ))}
    </SelectField>
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
