// CreateCodeFields —— CodeCreateModal 的字段块。A.3-IAM-5：code 只挂
// assumed_role_id；老 permissions / skills / agent-skills picker 全删，
// ACL / capability gating 全部从 role 推断。

import { CodeRolePicker } from '@/components/admin/modals/CodeRolePicker';
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
      <CodeRolePicker form={form} />
      <QuestionsField form={form} />
    </>
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
    <div className="grid grid-cols-3 gap-5">
      <QuotaInput
        label="names (people) · blank = unlimited"
        testid="code-max-members"
        placeholder="e.g. 5 (5 candidates)"
        value={form.values.maxMembers}
        onChange={form.setMaxMembers}
      />
      <QuotaInput
        label="turns per session · blank = unlimited"
        testid="code-max-turns"
        placeholder="e.g. 10"
        value={form.values.maxTurns}
        onChange={form.setMaxTurns}
      />
      <QuotaInput
        label="bookings per code · blank = unlimited"
        testid="code-max-bookings"
        placeholder="e.g. 3 (role must have calendar.book skill)"
        value={form.values.maxBookings}
        onChange={form.setMaxBookings}
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
