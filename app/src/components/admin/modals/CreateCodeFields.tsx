// CreateCodeFields —— CodeCreateModal 的字段块。拆出来才不踩 70-line 上限。
// retrieval-redesign 后：tags scope 字段砍掉，corpus_permissions 走 JSON
// textarea (简单 follow-up 升级成可视化编辑器)。

import { useSkills } from '@/lib/admin/use-skills';
import type { CodeFormHook } from '@/lib/admin/use-code-form';

type Props = { form: CodeFormHook };
type EditingProps = { form: CodeFormHook; editing: boolean };

export function CreateCodeFields({ form, editing }: EditingProps) {
  return (
    <div className="space-y-7">
      <CoreFieldsSlot form={form} editing={editing} />
      <QuotasField form={form} />
      <NonQuotaSlot form={form} editing={editing} />
    </div>
  );
}

function CoreFieldsSlot({ form, editing }: EditingProps) {
  return editing ? null : <CoreFields form={form} />;
}

function NonQuotaSlot({ form, editing }: EditingProps) {
  return editing ? null : (
    <>
      <PermissionsField form={form} />
      <SkillsPicker form={form} />
      <QuestionsField form={form} />
    </>
  );
}

function SkillsPicker({ form }: Props) {
  const hook = useSkills();
  return (
    <div>
      <FieldKicker text="skills · AI persona fragments (none = base only)" />
      <SkillsPickerList form={form} hook={hook} />
    </div>
  );
}

function SkillsPickerList({
  form, hook,
}: { form: CodeFormHook; hook: ReturnType<typeof useSkills> }) {
  return hook.skills.length === 0
    ? <SkillsEmpty />
    : <SkillsPickerOptions form={form} hook={hook} />;
}

function SkillsEmpty() {
  return (
    <p className="reading-tight italic text-[13px] text-(--color-muted) mt-1">
      No skills yet — create one under Skills.
    </p>
  );
}

function SkillsPickerOptions({
  form, hook,
}: { form: CodeFormHook; hook: ReturnType<typeof useSkills> }) {
  return (
    <ul className="flex flex-wrap gap-2 mt-2" data-testid="code-skills-picker">
      {hook.skills.map((s) => (
        <li key={s.id}>
          <SkillToggle
            id={s.id}
            name={s.name}
            selected={form.values.skillIDs.includes(s.id)}
            onToggle={() => form.toggleSkill(s.id)}
          />
        </li>
      ))}
    </ul>
  );
}

function SkillToggle({
  id, name, selected, onToggle,
}: { id: string; name: string; selected: boolean; onToggle: () => void }) {
  const cls = selected
    ? 'border-(--color-accent) text-(--color-accent)'
    : 'border-(--color-rule) text-(--color-muted) hover:text-(--color-ink)';
  return (
    <button
      type="button"
      data-testid={`code-skill-${name}`}
      data-skill-id={id}
      onClick={onToggle}
      aria-pressed={selected}
      className={`border px-3 py-1.5 mono text-[11px] tracking-[0.08em] uppercase ${cls}`}
    >
      {name}
    </button>
  );
}

function CoreFields({ form }: Props) {
  return (
    <div className="grid grid-cols-2 gap-5">
      <LabelInput form={form} />
      <PurposeInput form={form} />
      <CodeInput form={form} />
    </div>
  );
}

function LabelInput({ form }: Props) {
  return (
    <label className="block">
      <FieldKicker text="label" />
      <input
        type="text"
        data-testid="code-label"
        value={form.values.label}
        onChange={(e) => form.setLabel(e.target.value)}
        placeholder="e.g. OpenAI eng loop"
        className="w-full bg-transparent border-b border-(--color-rule) focus:border-(--color-ink) py-2 reading-tight text-[15.5px]"
      />
    </label>
  );
}

function PurposeInput({ form }: Props) {
  return (
    <label className="block">
      <FieldKicker text="purpose · private to you" />
      <input
        type="text"
        value={form.values.purpose}
        onChange={(e) => form.setPurpose(e.target.value)}
        placeholder="e.g. staff eng interview screening"
        className="w-full bg-transparent border-b border-(--color-rule) focus:border-(--color-ink) py-2 reading-tight text-[15.5px]"
      />
    </label>
  );
}

function CodeInput({ form }: Props) {
  return (
    <label className="block col-span-2">
      <FieldKicker text="code · LABEL-XXX" />
      <input
        type="text"
        data-testid="code-input"
        value={form.values.code}
        onChange={(e) => form.setCode(e.target.value)}
        placeholder="OPENAI-001"
        className="w-full bg-transparent border-b border-(--color-rule) focus:border-(--color-ink) py-2 mono text-[15px] uppercase"
      />
    </label>
  );
}

function QuotasField({ form }: Props) {
  return (
    <div className="grid grid-cols-2 gap-5">
      <QuotaInput
        label="sessions per visitor · blank = unlimited"
        testid="code-max-sessions"
        placeholder="e.g. 5 (interview rounds)"
        value={form.values.maxSessions}
        onChange={form.setMaxSessions}
      />
      <QuotaInput
        label="turns per session · blank = unlimited"
        testid="code-max-turns"
        placeholder="e.g. 10"
        value={form.values.maxTurns}
        onChange={form.setMaxTurns}
      />
    </div>
  );
}

function QuotaInput({
  label, testid, placeholder, value, onChange,
}: {
  label: string;
  testid: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <FieldKicker text={label} />
      <input
        type="number"
        min={1}
        inputMode="numeric"
        data-testid={testid}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-transparent border-b border-(--color-rule) focus:border-(--color-ink) py-2 mono text-[15px]"
      />
    </label>
  );
}

// PermissionsField —— path-glob ACL (corpus_permissions) JSON 编辑器。
// 空 = 允许全部 (legacy 兼容)。owner 写 `[{action:"deny",path_pattern:"personal/**",order:10}]`
// 那种 array 直接落库。可视化编辑器 follow-up。
function PermissionsField({ form }: Props) {
  return (
    <label className="block">
      <FieldKicker text="corpus_permissions · JSON array (empty = unrestricted)" />
      <textarea
        rows={6}
        data-testid="code-permissions"
        value={form.values.permissionsRaw}
        onChange={(e) => form.setPermissionsRaw(e.target.value)}
        spellCheck={false}
        placeholder='[{"action":"deny","path_pattern":"personal/**","order":10},
 {"action":"allow","path_pattern":"**","order":100}]'
        className="w-full bg-transparent border border-(--color-rule) focus:border-(--color-ink) p-2 mono text-[13px]"
      />
    </label>
  );
}

function QuestionsField({ form }: Props) {
  return (
    <div>
      <QuestionsHead form={form} />
      <div className="space-y-2">
        {form.values.suggested.map((q, i) => (
          <QuestionRow key={i} idx={i} value={q} form={form} />
        ))}
      </div>
    </div>
  );
}

function QuestionsHead({ form }: Props) {
  return (
    <div className="flex items-baseline justify-between mb-2">
      <FieldKicker text="suggested questions" />
      <button
        type="button"
        onClick={form.addQ}
        className="mono text-[10.5px] tracking-[0.14em] uppercase text-(--color-muted) hover:text-(--color-ink)"
      >
        ＋ add
      </button>
    </div>
  );
}

function QuestionRow({
  idx, value, form,
}: { idx: number; value: string; form: CodeFormHook }) {
  return (
    <div className="flex items-baseline gap-3 border-b border-(--color-rule)/60">
      <span className="mono text-[10px] text-(--color-faint) tabular-nums w-5 pt-1">
        {String(idx + 1).padStart(2, '0')}
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => form.updateQ(idx, e.target.value)}
        placeholder="a question the visitor might ask"
        className="flex-1 bg-transparent py-2 reading-tight italic text-[15px]"
      />
      <button
        type="button"
        onClick={() => form.removeQ(idx)}
        className="mono text-[10px] text-(--color-faint) hover:text-(--color-accent) pt-1"
      >
        ×
      </button>
    </div>
  );
}

function FieldKicker({ text }: { text: string }) {
  return (
    <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-2">
      {text}
    </div>
  );
}
