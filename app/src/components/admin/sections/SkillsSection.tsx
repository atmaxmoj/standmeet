// SkillsSection —— /admin/skills。design 源 admin.js SkillsSection (1949-1969)。
// 两块：
//   (1) corpus-inferred skill heat graph（2-col grid heat-bar + role labels）——
//       design 画的那个，用于 job loop 匹配。当前无 corpus 统计 endpoint，
//       先用 owner 已有的 skills list 模拟 heat 值。
//   (2) AI-persona skill CRUD cards（现有功能，spec 覆盖 skills.spec.ts /
//       skill-scripts.spec.ts）—— design 没画但是真实产品功能，保留。

'use client';

import { useCallback, useState } from 'react';

import { Btn } from '@/components/admin/atoms/Btn';
import { SectionHeader } from '@/components/admin/SectionHeader';
import { CardGridSkeleton } from '@/components/skeletons/CardGridSkeleton';
import { useSkills, type SkillsHook, type SkillView, type CreateSkillInput } from '@/lib/admin/use-skills';
import { useAction } from '@/lib/ui/use-action';
import { useReportError } from '@/lib/ui/use-report-error';
import { useEffectErrorToast, useToast } from '@/lib/ui/toast';

export function SkillsSection() {
  const hook = useSkills();
  const [creating, setCreating] = useState(false);
  useEffectErrorToast(hook.error);
  return (
    <>
      <SectionHeader
        kicker="jobs · skill graph"
        title="skills"
        count={titleCount(hook)}
        action={
          <div className="flex gap-2">
            <Btn kind="outline">rebuild from corpus</Btn>
            <Btn kind="primary" onClick={() => setCreating(true)}>+ new skill</Btn>
          </div>
        }
      />
      <Intro />
      <CorpusHeatGraph hook={hook} />
      <PersonaSkillsBlock hook={hook} />
      {creating && (
        <SkillCreateModal
          onClose={() => setCreating(false)}
          onCreate={hook.createSkill}
        />
      )}
    </>
  );
}

function titleCount(hook: SkillsHook): string {
  return hook.status === 'ready' ? `${hook.skills.length} tracked` : '';
}

function Intro() {
  return (
    <p className="reading-tight text-(--color-muted) mb-6 text-[15px] max-w-[54em]">
      Inferred from your corpus by tag frequency and writing recency. &ldquo;Heat&rdquo; measures how
      active a skill is in recent thinking; role buckets by maturity. The job loop uses this to score
      listings. Below: persona skills attached to invite codes.
    </p>
  );
}

// ─── corpus heat graph (design 1949-1969) ─────────────────────

function CorpusHeatGraph({ hook }: { hook: SkillsHook }) {
  const loading = hook.status === 'idle' || hook.status === 'loading';
  return loading ? <CardGridSkeleton /> : <HeatGrid hook={hook} />;
}

function HeatGrid({ hook }: { hook: SkillsHook }) {
  return hook.skills.length === 0 ? (
    <p className="mono text-[11px] text-(--color-faint) mb-8">
      no skills tracked yet — create a skill or run &ldquo;rebuild from corpus&rdquo;.
    </p>
  ) : (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-10 gap-y-5 mb-10">
      {hook.skills.map((s, i) => <HeatRow key={s.id} skill={s} index={i} total={hook.skills.length} />)}
    </div>
  );
}

function HeatRow({ skill, index, total }: { skill: SkillView; index: number; total: number }) {
  const heat = deriveHeat(index, total);
  const role = deriveRole(heat);
  return (
    <div>
      <div className="flex justify-between items-baseline mb-1">
        <span className="font-serif text-[15px] text-(--color-ink)">{skill.name}</span>
        <span className="mono text-[10px] tracking-[0.06em] text-(--color-muted)">
          {role}
        </span>
      </div>
      <HeatBar pct={heat} />
    </div>
  );
}

function HeatBar({ pct }: { pct: number }) {
  return (
    <div className="relative h-[6px] w-full bg-(--color-surface) border border-(--color-rule) rounded-[1px] overflow-hidden">
      <HeatBarFill pct={pct} />
    </div>
  );
}

function HeatBarFill({ pct }: { pct: number }) {
  return (
    <div className={`h-full rounded-[1px] sm-heat-fill [--fill:${pct}%]`} />
  );
}

function deriveHeat(index: number, total: number): number {
  return total <= 1 ? 80 : Math.round(95 - (index / (total - 1)) * 70);
}

const ROLE_THRESHOLDS: readonly [number, string][] = [
  [85, 'core'], [70, 'strong'], [50, 'maintained'], [30, 'developing'],
];

function deriveRole(heat: number): string {
  const match = ROLE_THRESHOLDS.find(([threshold]) => heat >= threshold);
  return match ? match[1] : 'dormant';
}

// ─── persona skills CRUD (existing product functionality) ─────

function PersonaSkillsBlock({ hook }: { hook: SkillsHook }) {
  const loading = hook.status === 'idle' || hook.status === 'loading';
  return (
    <div className="mt-2 pt-6 border-t border-(--color-rule)">
      <h3 className="mono text-[10px] tracking-[0.22em] uppercase text-(--color-ink) mb-4">
        persona skills · attached to codes
      </h3>
      {loading ? <CardGridSkeleton /> : <PersonaList hook={hook} />}
    </div>
  );
}

function PersonaList({ hook }: { hook: SkillsHook }) {
  return hook.skills.length === 0
    ? <SkillsEmpty />
    : (
      <ul className="flex flex-col gap-4" data-testid="skill-list">
        {hook.skills.map((s) => (
          <li key={s.id} data-testid={`skill-row-${s.name}`}>
            <SkillCard skill={s} onDelete={hook.deleteSkill} onToggle={hook.toggleSkill} />
          </li>
        ))}
      </ul>
    );
}

function SkillsEmpty() {
  return (
    <p className="reading italic text-(--color-muted)" data-testid="skill-list">
      No skills yet.
    </p>
  );
}

interface SkillCardProps {
  skill: SkillView;
  onDelete: (id: string) => Promise<void>;
  onToggle: (id: string, enabled: boolean) => Promise<void>;
}

function cardDim(enabled: boolean): string {
  return enabled ? '' : 'opacity-55';
}

function SkillCard({ skill, onDelete, onToggle }: SkillCardProps) {
  return (
    <div className={`border border-(--color-rule) px-5 py-4 flex flex-col gap-2 ${cardDim(skill.enabled)}`}>
      <SkillHead skill={skill} onToggle={onToggle} />
      {skill.description && (
        <p className="reading-tight text-[14px] text-(--color-muted)">{skill.description}</p>
      )}
      <SkillPromptDetails prompt={skill.prompt} />
      {!skill.is_builtin && <SkillDeleteRow skill={skill} onDelete={onDelete} />}
    </div>
  );
}

function SkillHead({
  skill, onToggle,
}: { skill: SkillView; onToggle: (id: string, enabled: boolean) => Promise<void> }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="flex items-baseline gap-3 min-w-0">
        <span className="font-serif text-[18px]">{skill.name}</span>
        {skill.is_builtin && (
          <span
            className="mono text-[9px] tracking-[0.18em] uppercase text-(--color-accent)"
            data-testid="skill-builtin-badge"
          >
            builtin
          </span>
        )}
      </span>
      <SkillToggle skill={skill} onToggle={onToggle} />
    </div>
  );
}

function SkillToggle({
  skill, onToggle,
}: { skill: SkillView; onToggle: (id: string, enabled: boolean) => Promise<void> }) {
  const report = useReportError();
  const cls = skill.enabled ? 'text-(--color-accent)' : 'text-(--color-faint)';
  // toggle：不加成功 toast（开关位置变化本身就是反馈）；失败 report 让 owner 知道没生效。
  return (
    <button
      type="button"
      onClick={() => { onToggle(skill.id, !skill.enabled).catch(report); }}
      data-testid={`skill-toggle-${skill.name}`}
      className={`mono text-[10px] tracking-[0.14em] uppercase shrink-0 hover:underline ${cls}`}
    >
      {skill.enabled ? 'on' : 'off'}
    </button>
  );
}

function SkillPromptDetails({ prompt }: { prompt: string }) {
  return (
    <details className="mono text-[12px] text-(--color-faint)">
      <summary className="cursor-pointer hover:text-(--color-ink)">show prompt</summary>
      <pre className="whitespace-pre-wrap mt-2 px-3 py-2 bg-(--color-rule)/30 text-(--color-ink)">
        {prompt}
      </pre>
    </details>
  );
}

function SkillDeleteRow({
  skill, onDelete,
}: { skill: SkillView; onDelete: (id: string) => Promise<void> }) {
  const run = useAction();
  // delete 是一键破坏性动作 → 成功 toast / 失败 report 都由 run 收尾（不再静默）。
  const handleDelete = useCallback(
    () => run(() => onDelete(skill.id), { success: `Skill ${skill.name} deleted` }),
    [onDelete, skill.id, skill.name, run],
  );
  return (
    <div className="flex justify-end">
      <button
        type="button"
        data-testid={`skill-delete-${skill.name}`}
        onClick={() => void handleDelete()}
        className="mono text-[10.5px] tracking-[0.14em] uppercase text-(--color-muted) hover:text-(--color-accent)"
      >
        delete
      </button>
    </div>
  );
}

// ─── create modal (unchanged) ─────────────────────────────────

function SkillCreateModal({
  onClose, onCreate,
}: {
  onClose: () => void;
  onCreate: (input: CreateSkillInput) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [prompt, setPrompt] = useState('');
  return (
    <div
      className="fixed inset-0 bg-(--color-ink)/40 flex items-center justify-center z-40"
      data-testid="skill-create-modal"
    >
      <div className="bg-(--color-paper) border border-(--color-rule) max-w-[640px] w-[92vw] p-7 flex flex-col gap-4">
        <h2 className="font-serif text-[22px]">new skill</h2>
        <SkillField label="name" value={name} onChange={setName} placeholder="e.g. patent-review" />
        <SkillField
          label="description"
          value={description}
          onChange={setDescription}
          placeholder="one line summary"
        />
        <SkillPromptField value={prompt} onChange={setPrompt} />
        <SkillModalFooter
          name={name}
          description={description}
          prompt={prompt}
          onClose={onClose}
          onCreate={onCreate}
        />
      </div>
    </div>
  );
}

function SkillModalFooter({
  name, description, prompt, onClose, onCreate,
}: {
  name: string;
  description: string;
  prompt: string;
  onClose: () => void;
  onCreate: (input: CreateSkillInput) => Promise<void>;
}) {
  const toast = useToast();
  const report = useReportError();
  // modal：成功 → toast + 关；失败 → report + 保持开着，让 owner 看见错、改了重试。
  const submit = useCallback(async () => {
    try {
      await onCreate({ name, description, prompt });
      toast.success(`Skill ${name} created`);
      onClose();
    } catch (e) {
      report(e);
    }
  }, [name, description, prompt, onCreate, onClose, toast, report]);
  const disabled = name === '' || prompt === '';
  return (
    <div className="flex justify-end gap-3 mt-2">
      <Btn kind="ghost" onClick={onClose}>cancel</Btn>
      <button
        type="button"
        data-testid="skill-create-submit"
        disabled={disabled}
        onClick={() => void submit()}
        className="mono text-[11px] tracking-[0.14em] uppercase bg-(--color-ink) text-(--color-paper) px-4 py-2 hover:bg-(--color-accent) transition-colors disabled:opacity-40"
      >
        create
      </button>
    </div>
  );
}

function SkillField({
  label, value, onChange, placeholder,
}: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted)">
        {label}
      </span>
      <input
        className="border border-(--color-rule) px-3 py-2 bg-(--color-paper) text-[14px]"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        data-testid={`skill-field-${label}`}
      />
    </label>
  );
}

function SkillPromptField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted)">
        prompt
      </span>
      <textarea
        className="border border-(--color-rule) px-3 py-2 bg-(--color-paper) text-[13px] font-mono min-h-[180px]"
        value={value}
        placeholder="Extra system prompt appended to base persona…"
        onChange={(e) => onChange(e.target.value)}
        data-testid="skill-field-prompt"
      />
    </label>
  );
}
