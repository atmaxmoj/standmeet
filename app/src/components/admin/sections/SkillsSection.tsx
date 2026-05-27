// SkillsSection —— /admin/skills。owner-curated AI persona/能力包。
// builtin skills 不可删 + 标 BUILTIN。"+ new skill" 弹一个简单 modal 接 name +
// description + prompt 三字段。

'use client';

import { useCallback, useState } from 'react';

import { Btn } from '@/components/admin/atoms/Btn';
import { SectionHeader } from '@/components/admin/SectionHeader';
import { CardGridSkeleton } from '@/components/skeletons/CardGridSkeleton';
import { useSkills, type SkillsHook, type SkillView, type CreateSkillInput } from '@/lib/admin/use-skills';
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
        action={<Btn kind="primary" onClick={() => setCreating(true)}>＋ new skill</Btn>}
      />
      <Intro />
      <SkillListBody hook={hook} />
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
  return hook.status === 'ready' ? `${hook.skills.length} skills` : '';
}

function Intro() {
  return (
    <p className="reading-tight text-(--color-muted) mb-6 text-[15px] max-w-[54em]">
      Skills serve two purposes: (1) extra system-prompt fragments composed into the visitor-facing AI —
      attach one or more to an invite code and the AI gains that persona; (2) corpus-inferred heat map
      used by the job loop to score listings against your strengths.
      Builtin skills can&apos;t be deleted; create your own to layer.
    </p>
  );
}

function SkillListBody({ hook }: { hook: SkillsHook }) {
  const loading = hook.status === 'idle' || hook.status === 'loading';
  return loading
    ? <CardGridSkeleton />
    : <SkillListReady hook={hook} />;
}

function SkillListReady({ hook }: { hook: SkillsHook }) {
  return hook.skills.length === 0
    ? <SkillsEmpty />
    : <SkillsList hook={hook} />;
}

function SkillsEmpty() {
  return (
    <p className="reading italic text-(--color-muted)" data-testid="skill-list">
      No skills yet.
    </p>
  );
}

function SkillsList({ hook }: { hook: SkillsHook }) {
  return (
    <ul className="flex flex-col gap-4" data-testid="skill-list">
      {hook.skills.map((s) => (
        <li key={s.id} data-testid={`skill-row-${s.name}`}>
          <SkillCard skill={s} onDelete={hook.deleteSkill} />
        </li>
      ))}
    </ul>
  );
}

function SkillCard({
  skill, onDelete,
}: { skill: SkillView; onDelete: (id: string) => Promise<boolean> }) {
  return (
    <div className="border border-(--color-rule) px-5 py-4 flex flex-col gap-2">
      <SkillHead skill={skill} />
      {skill.description && (
        <p className="reading-tight text-[14px] text-(--color-muted)">{skill.description}</p>
      )}
      <SkillPromptDetails prompt={skill.prompt} />
      {!skill.is_builtin && <SkillDeleteRow skill={skill} onDelete={onDelete} />}
    </div>
  );
}

function SkillHead({ skill }: { skill: SkillView }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="font-serif text-[18px]">{skill.name}</span>
      {skill.is_builtin && (
        <span
          className="mono text-[9px] tracking-[0.18em] uppercase text-(--color-accent)"
          data-testid="skill-builtin-badge"
        >
          builtin
        </span>
      )}
    </div>
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
}: { skill: SkillView; onDelete: (id: string) => Promise<boolean> }) {
  const toast = useToast();
  const handleDelete = useCallback(async () => {
    const ok = await onDelete(skill.id);
    ok && toast.success(`Skill ${skill.name} deleted`);
  }, [onDelete, skill.id, skill.name, toast]);
  return (
    <div className="flex justify-end">
      <button
        type="button"
        data-testid="skill-delete"
        onClick={() => void handleDelete()}
        className="mono text-[10.5px] tracking-[0.14em] uppercase text-(--color-muted) hover:text-(--color-accent)"
      >
        delete
      </button>
    </div>
  );
}

function SkillCreateModal({
  onClose, onCreate,
}: {
  onClose: () => void;
  onCreate: (input: CreateSkillInput) => Promise<boolean>;
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
  onCreate: (input: CreateSkillInput) => Promise<boolean>;
}) {
  const toast = useToast();
  const submit = useCallback(async () => {
    const ok = await onCreate({ name, description, prompt });
    ok && toast.success(`Skill ${name} created`);
    ok && onClose();
  }, [name, description, prompt, onCreate, onClose, toast]);
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
