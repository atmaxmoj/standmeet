// CodePromptPicker —— code create modal 里的 per-code prompt dropdown（#104）。
// 引集中管理的 prompts 库；'' = 不挂（persona 只有 role 那份）。拆出来守
// CreateCodeFields.tsx 的 max-lines，跟 CodeRolePicker 同款结构。

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
  return (
    <select
      className="border border-(--color-rule) px-3 py-2 bg-(--color-paper) text-[14px] w-full"
      value={form.values.promptID}
      onChange={(e) => form.setPromptID(e.target.value)}
      data-testid="code-field-prompt"
    >
      <option value="">— none —</option>
      {prompts.map((p) => (
        <option key={p.id} value={p.id}>{p.name}</option>
      ))}
    </select>
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
