// CodePromptPicker — the per-code prompt dropdown inside the code create modal (#104).
// References the centrally-managed prompts library; '' = none attached (persona
// comes only from the role). Split out to keep CreateCodeFields.tsx under max-lines;
// same structure as CodeRolePicker.

import { useTranslations } from 'next-intl';

import { SelectField } from '@/components/atoms/SelectField';
import { usePrompts, type PromptView } from '@/lib/admin/use-prompts';
import type { CodeFormHook } from '@/lib/admin/use-code-form';

type Props = { form: CodeFormHook };

export function CodePromptPicker({ form }: Props) {
  const hook = usePrompts();
  return (
    <CodePromptSection title="prompt" subtitle="frozen at issue; adds to the role persona">
      <CodePromptSelect form={form} prompts={hook.prompts} />
    </CodePromptSection>
  );
}

function CodePromptSelect({
  form, prompts,
}: { form: CodeFormHook; prompts: readonly PromptView[] }) {
  const t = useTranslations('adminShell.codeModal');
  return (
    <SelectField
      className="w-full"
      value={form.values.promptID}
      onChange={(e) => form.setPromptID(e.target.value)}
      testid="code-field-prompt"
    >
      <option value="">{t('promptNone')}</option>
      {prompts.map((p) => (
        <option key={p.id} value={p.id}>{p.name}</option>
      ))}
    </SelectField>
  );
}

function CodePromptSection({
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
