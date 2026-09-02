// SkillsSection —— /admin/skills. **The single entry point to the owner's skill registry.**
//
// This used to be two pages: /admin/skills (this CRUD list) + /admin/agent-skills (MY SKILLS +
// MARKETPLACE). But they're **the same registry**: use-agent-skills's installed comes straight
// from use-skills, and marketplace install writes to the same backend table. One concept, one
// dataset, two top-level entry points, two nearly-identically-named sidebar labels — the owner
// had to manage the same batch of things in two places, with no clue in the UI that they were the
// same batch. That's rot (rot-D1); now it's merged into one tab page.
//
//   tab "my skills" —— this registry: hand-built + installed from marketplace (SkillCard already
//   distinguishes by is_builtin).
//   tab "marketplace" —— search + install from GitHub anthropics/skills + SkillsMP. After install
//   → switches back to my skills.
//
// Removed: the `/admin/agent-skills` gate (now redirects here) + its InstalledCard (a weaker
// duplicate render of SkillCard, whose "updates available" banner was never implemented); and
// the skill heatmap that used to claim "corpus-inferred" here (**it was fabricated** — heat =
// list index, the rot-A1 class) + the dead "rebuild" button with no onClick (rot-G1).
// Real corpus heat needs a real endpoint — see docs/real-env-verification/items/skill-corpus-heat.md.

'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

import { Btn } from '@/components/admin/atoms/Btn';
import { SectionHeader } from '@/components/admin/SectionHeader';
import { ListPane } from '@/components/admin/ListPane';
import { MarketplaceTab } from '@/components/admin/sections/agent-skills/MarketplaceTab';
import { SkillsTabs, type SkillsTab } from '@/components/admin/sections/skills/SkillsTabs';
import { useAgentSkills } from '@/lib/admin/use-agent-skills';
import { useSkills, type SkillsHook, type SkillView, type CreateSkillInput } from '@/lib/admin/use-skills';
import { useAction } from '@/lib/ui/use-action';
import { useReportError } from '@/lib/ui/use-report-error';
import { useEffectErrorToast, useToast } from '@/lib/ui/toast';

// connectorLabel was removed (F-F-4): it hand-mapped connector rows to 'Calendar' / 'Email' so
// the client could compute the `needs − connected` difference itself. That was a **third name**
// for the same thing (dep name `smtp` / connector category `mail` / `Email` here), and both
// halves needed for the difference already lived on the server. The server now answers directly
// which connectors a card is still missing, and the card just renders it.
export function SkillsSection() {
  const skills = useSkills();
  const agent = useAgentSkills();
  const [creating, setCreating] = useState(false);
  const [tab, setTab] = useState<SkillsTab>('installed');
  useEffectErrorToast(skills.error);
  // install complete → switches back to my skills, so the owner watches the new skill land in the list.
  useEffect(() => { (agent.lastInstalledAt > 0) && setTab('installed'); }, [agent.lastInstalledAt]);
  return (
    <>
      <SectionHeader
        kicker="ai · skills"
        slug="skills"
        count={titleCount(skills)}
        action={<HeaderActions tab={tab} setTab={setTab} onNew={() => setCreating(true)} />}
      />
      <SkillsBody tab={tab} skills={skills} agent={agent} />
      {creating && (
        <SkillCreateModal onClose={() => setCreating(false)} onCreate={skills.createSkill} />
      )}
    </>
  );
}

function HeaderActions({
  tab, setTab, onNew,
}: { tab: SkillsTab; setTab: (t: SkillsTab) => void; onNew: () => void }) {
  const t = useTranslations('adminIntegrations.skills');
  return (
    <div className="flex items-center gap-3">
      <SkillsTabs tab={tab} setTab={setTab} />
      <Btn kind="solid" onClick={onNew}>{t('new')}</Btn>
    </div>
  );
}

// SkillsBody —— my skills (this registry's CRUD list) or marketplace (search + install).
function SkillsBody({
  tab, skills, agent,
}: {
  tab: SkillsTab; skills: SkillsHook;
  agent: ReturnType<typeof useAgentSkills>;
}) {
  return tab === 'marketplace'
    ? <MarketplaceTab hook={agent} />
    : <PersonaSkillsBlock hook={skills} />;
}

function titleCount(hook: SkillsHook): string {
  return hook.status === 'ready' ? `${hook.skills.length} tracked` : '';
}

// ─── my skills: this registry's CRUD list ─────────────────────

function PersonaSkillsBlock({ hook }: { hook: SkillsHook }) {
  return (
    <ListPane status={hook.status} count={hook.skills.length} empty={<SkillsEmpty />}>
      <PersonaList hook={hook} />
    </ListPane>
  );
}

function PersonaList({ hook }: { hook: SkillsHook }) {
  return (
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
  // toggle: no success toast (the switch's position change is feedback enough); failure reports
  // so the owner knows it didn't take.
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
  // delete is a one-click destructive action → run wraps up both success toast and failure
  // report (no longer silent).
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
      className="fixed inset-0 bg-[var(--sm-scrim)] flex items-center justify-center sm-z-modal"
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
  // modal: success → toast + close; failure → report + stays open, so the owner sees the error,
  // fixes it, and retries.
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
        className="sm-field-input"
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
