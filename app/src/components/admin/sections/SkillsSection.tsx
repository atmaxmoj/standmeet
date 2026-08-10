// SkillsSection —— /admin/skills。**owner 的 skill registry 的唯一入口**。
//
// 曾经是两个页面：/admin/skills（这份 CRUD 列表）+ /admin/agent-skills（MY SKILLS + MARKETPLACE）。
// 但它们是**同一份 registry**：use-agent-skills 的 installed 直接来自 use-skills，marketplace install
// 后端写的也是同一张表。一个概念、一份数据、两个顶层入口、两个几乎同名的侧栏标签 —— owner 得在两个
// 地方管同一批东西，界面上却没有线索说它们是同一批。那是腐化（rot-D1），现在合并成一个 tab 页。
//
//   tab「my skills」—— 这份 registry：手写建的 + 从 marketplace 装的（SkillCard 已按 is_builtin 区分）。
//   tab「marketplace」—— 从 GitHub anthropics/skills + SkillsMP 搜索 + 安装。install 完 → 切回 my skills。
//
// 删掉的东西：`/admin/agent-skills` 那个门（重定向到这里）+ 它那份 InstalledCard（比 SkillCard 更弱的
// 重复渲染，其「updates available 横幅」从来没实装）；还有曾经这里那张自称 "corpus-inferred" 的 skill
// 热力图（**是编的** —— 热度=列表下标，rot-A1 类）+ 那个没有 onClick 的 "rebuild" 死按钮（rot-G1）。
// 真的 corpus 热度要接真 endpoint —— 见 docs/real-env-verification/items/skill-corpus-heat.md。

'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

import { Btn } from '@/components/admin/atoms/Btn';
import { SectionHeader } from '@/components/admin/SectionHeader';
import { CardGridSkeleton } from '@/components/skeletons/CardGridSkeleton';
import { MarketplaceTab } from '@/components/admin/sections/agent-skills/MarketplaceTab';
import { SkillsTabs, type SkillsTab } from '@/components/admin/sections/skills/SkillsTabs';
import { useAgentSkills } from '@/lib/admin/use-agent-skills';
import { useConnectorList, type ConnectorRow } from '@/lib/admin/use-connector-list';
import { useSkills, type SkillsHook, type SkillView, type CreateSkillInput } from '@/lib/admin/use-skills';
import { useAction } from '@/lib/ui/use-action';
import { useReportError } from '@/lib/ui/use-report-error';
import { useEffectErrorToast, useToast } from '@/lib/ui/toast';

// connectorLabel —— 连接器行 → skill.needs 用的 label 词汇（'Calendar' / 'Email'）。
// 一个 skill 声明 needs:['Calendar']，只有当 owner **真的**连了 calendar 连接器时才不该警告。
function connectorLabel(row: ConnectorRow): string {
  const key = `${row.category} ${row.kind}`.toLowerCase();
  return key.includes('calendar') ? 'Calendar' : key.includes('mail') ? 'Email' : row.category;
}

export function SkillsSection() {
  const skills = useSkills();
  const agent = useAgentSkills();
  const connectors = useConnectorList();
  const [creating, setCreating] = useState(false);
  const [tab, setTab] = useState<SkillsTab>('installed');
  useEffectErrorToast(skills.error);
  // install 完成 → 切回 my skills，owner 看着新 skill 落进列表。
  useEffect(() => { (agent.lastInstalledAt > 0) && setTab('installed'); }, [agent.lastInstalledAt]);
  // connected —— owner **真正**连上的连接器 label（rot-A4：以前是硬编码 ['Email','Calendar']，于是
  // 一个需要 Calendar 的 skill 即便 owner 没连 Calendar 也不警告）。空实例 → [] → 该警告的都警告。
  const connected = connectors.connectors.filter((c) => c.connected).map(connectorLabel);
  return (
    <>
      <SectionHeader
        kicker="ai · skills"
        title="skills"
        count={titleCount(skills)}
        action={<HeaderActions tab={tab} setTab={setTab} onNew={() => setCreating(true)} />}
      />
      <SkillsBody tab={tab} skills={skills} agent={agent} connected={connected} />
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
      <Btn kind="primary" onClick={onNew}>{t('new')}</Btn>
    </div>
  );
}

// SkillsBody —— my skills（这份 registry 的 CRUD 列表）或 marketplace（搜索 + 安装）。
function SkillsBody({
  tab, skills, agent, connected,
}: {
  tab: SkillsTab; skills: SkillsHook;
  agent: ReturnType<typeof useAgentSkills>; connected: readonly string[];
}) {
  return tab === 'marketplace'
    ? <MarketplaceTab hook={agent} connected={connected} />
    : <PersonaSkillsBlock hook={skills} />;
}

function titleCount(hook: SkillsHook): string {
  return hook.status === 'ready' ? `${hook.skills.length} tracked` : '';
}

// ─── my skills：这份 registry 的 CRUD 列表 ─────────────────────

function PersonaSkillsBlock({ hook }: { hook: SkillsHook }) {
  const loading = hook.status === 'idle' || hook.status === 'loading';
  return loading ? <CardGridSkeleton /> : <PersonaList hook={hook} />;
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
      className="fixed inset-0 bg-[var(--sm-scrim)] flex items-center justify-center z-40"
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
