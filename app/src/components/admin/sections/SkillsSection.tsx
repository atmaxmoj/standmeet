// SkillsSection —— /admin/skills。design 源 admin.js SkillsSection (1949-1969)。
//
//   (1) corpus-inferred skill heat graph —— design 画了，**但至今没有 corpus 统计 endpoint**，
//       所以它现在只渲染「还没有数据」的空态。
//
//       它曾经不是空的，而是**编的**：`deriveHeat(index, total) = 95 - (index/(total-1))*70`
//       —— 所谓"热度"就是这条 skill 在列表里的下标，然后据此贴上 core / strong / maintained /
//       developing / dormant。第一条永远 core，最后一条永远 dormant，跟 corpus 没有半点关系。
//       一张自称 "corpus-inferred" 的图表，宣称了它根本没有测量过的事实 —— 而 owner 会拿它
//       给 job loop 做匹配决定。没有图，owner 会去要；一张假图，owner 会信。
//       接上真 endpoint 之前，空态是唯一诚实的形态。
//
//   (2) AI-persona skill CRUD cards（现有功能，spec 覆盖 skills.spec.ts /
//       skill-scripts.spec.ts）—— design 没画但是真实产品功能，保留。

'use client';

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';

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
  const t = useTranslations('adminIntegrations.skills');
  useEffectErrorToast(hook.error);
  return (
    <>
      <SectionHeader
        kicker="jobs · skill graph"
        title="skills"
        count={titleCount(hook)}
        action={
          <div className="flex gap-2">
            <Btn kind="outline">{t('rebuild')}</Btn>
            <Btn kind="primary" onClick={() => setCreating(true)}>{t('new')}</Btn>
          </div>
        }
      />
      <Intro />
      <CorpusHeatGraph />
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
  const t = useTranslations('adminIntegrations.skills');
  return (
    <p className="reading-tight text-(--color-muted) mb-6 text-[15px] max-w-[54em]">
      {t('intro')}
    </p>
  );
}

// ─── corpus heat graph (design 1949-1969) ─────────────────────

// CorpusHeatGraph —— 真 corpus 统计 endpoint 到位之前，这里只能是空态（见文件头）。
// 不接 hook：没有任何输入能诚实地喂它。
function CorpusHeatGraph() {
  return <HeatEmpty />;
}

function HeatEmpty() {
  const t = useTranslations('adminIntegrations.skills');
  return (
    <p className="mono text-[11px] text-(--color-faint) mb-8">
      {t('heatEmpty')}
    </p>
  );
}

// ─── persona skills CRUD (existing product functionality) ─────

function PersonaSkillsBlock({ hook }: { hook: SkillsHook }) {
  const loading = hook.status === 'idle' || hook.status === 'loading';
  const t = useTranslations('adminIntegrations.skills');
  return (
    <div className="mt-2 pt-6 border-t border-(--color-rule)">
      <h3 className="mono text-[10px] tracking-[0.22em] uppercase text-(--color-ink) mb-4">
        {t('personaHeading')}
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
  const t = useTranslations('adminIntegrations.skills');
  return (
    <p className="reading italic text-(--color-muted)" data-testid="skill-list">
      {t('personaEmpty')}
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
  const t = useTranslations('adminIntegrations.skills');
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="flex items-baseline gap-3 min-w-0">
        <span className="font-serif text-[18px]">{skill.name}</span>
        {skill.is_builtin && (
          <span
            className="mono text-[9px] tracking-[0.18em] uppercase text-(--color-accent)"
            data-testid="skill-builtin-badge"
          >
            {t('builtin')}
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
  const t = useTranslations('adminIntegrations.skills');
  return (
    <details className="mono text-[12px] text-(--color-faint)">
      <summary className="cursor-pointer hover:text-(--color-ink)">{t('showPrompt')}</summary>
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
  const t = useTranslations('adminIntegrations.skills');
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
        {t('delete')}
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
  const t = useTranslations('adminIntegrations.skills');
  return (
    <div
      className="fixed inset-0 bg-(--color-ink)/40 flex items-center justify-center z-40"
      data-testid="skill-create-modal"
    >
      <div className="bg-(--color-paper) border border-(--color-rule) max-w-[640px] w-[92vw] p-7 flex flex-col gap-4">
        <h2 className="font-serif text-[22px]">{t('modalTitle')}</h2>
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
  const t = useTranslations('adminIntegrations.skills');
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
      <Btn kind="ghost" onClick={onClose}>{t('cancel')}</Btn>
      <button
        type="button"
        data-testid="skill-create-submit"
        disabled={disabled}
        onClick={() => void submit()}
        className="mono text-[11px] tracking-[0.14em] uppercase bg-(--color-ink) text-(--color-paper) px-4 py-2 hover:bg-(--color-accent) transition-colors disabled:opacity-40"
      >
        {t('create')}
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
  const t = useTranslations('adminIntegrations.skills');
  return (
    <label className="flex flex-col gap-1">
      <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted)">
        {t('promptLabel')}
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
