// CreateCodeFields —— CodeCreateModal 的字段块。拆出来才不踩 70-line 上限。

import { Chip } from '@/components/admin/atoms/Chip';

import type { CodeFormHook } from '@/lib/admin/use-code-form';

const SUGGESTED_TAGS = ['thinking', 'work', 'lucerna', 'private', 'fundraising', 'side-projects'];

type Props = { form: CodeFormHook };

export function CreateCodeFields({ form }: Props) {
  return (
    <div className="space-y-7">
      <CoreFields form={form} />
      <QuotasField form={form} />
      <TagsField form={form} />
      <ScopeField form={form} />
      <QuestionsField form={form} />
    </div>
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

// `code-tags` 字段保留以兼容 e2e。值经过 push-comma 触发 toggleInclude。
function TagsField({ form }: Props) {
  return (
    <label className="block">
      <FieldKicker text="included_tags · comma-separated" />
      <input
        type="text"
        data-testid="code-tags"
        value={form.values.scope.join(', ')}
        onChange={(e) => syncScope(e.target.value, form)}
        placeholder="intro, work"
        className="w-full bg-transparent border-b border-(--color-rule) focus:border-(--color-ink) py-2 mono text-[14px]"
      />
    </label>
  );
}

function syncScope(raw: string, form: CodeFormHook): void {
  const tokens = raw.split(',').map((t) => t.trim()).filter(Boolean);
  const current = new Set(form.values.scope);
  const next = new Set(tokens);
  current.forEach((t) => next.has(t) || form.toggleInclude(t));
  next.forEach((t) => current.has(t) || form.toggleInclude(t));
}

function ScopeField({ form }: Props) {
  return (
    <div>
      <FieldKicker text="suggested scope · click to include / exclude" />
      <div className="flex flex-wrap gap-1.5">
        {SUGGESTED_TAGS.map((t) => (
          <TagToggle key={t} tag={t} form={form} />
        ))}
      </div>
    </div>
  );
}

function TagToggle({ tag, form }: { tag: string; form: CodeFormHook }) {
  const inc = form.values.scope.includes(tag);
  const exc = form.values.excluded.includes(tag);
  const tone = exc ? 'private' : 'neutral';
  const onClick = () => (inc ? form.toggleExclude(tag) : form.toggleInclude(tag));
  return (
    <Chip tone={tone} active={inc} onClick={onClick}>
      <TagToggleLabel inc={inc} exc={exc} tag={tag} />
    </Chip>
  );
}

function TagToggleLabel({ inc, exc, tag }: { inc: boolean; exc: boolean; tag: string }) {
  const prefix = inc ? '✓ ' : exc ? '× ' : '';
  return <>{prefix}{tag}</>;
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
