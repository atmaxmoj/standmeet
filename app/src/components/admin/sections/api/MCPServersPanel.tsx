// MCPServersPanel —— owner-registered external MCP servers(agent 出站调的工具)
// 的 CRUD。owner 把别处拿到的 MCP server(URL + 可选 auth header)装载进来,
// 再在 roles 里挂给 access code。后端 /mcp-servers 全 real;auth value 加密落盘。
//
// 跟 connector panel 同视觉(crosshair 卡 + mono kicker)。
//
// 每一行还带一颗**只读探针**(check):去问那台 server 答不答话、有哪些工具。没有它,
// 一行 ext-MCP 上的全部证据就是 owner 自己粘进去的那个 URL(F-D-8)。

'use client';

import { useCallback, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';

import { AdminSectionHead } from '@/components/admin/AdminSectionHead';
import { useMCPServers, type CreateMCPServerInput, type MCPProbe, type MCPServersHook, type MCPServerView } from '@/lib/admin/use-mcp-servers';
import { useAction } from '@/lib/ui/use-action';

type FormState = Record<'name' | 'url' | 'authName' | 'authValue', string>;
const EMPTY: FormState = { name: '', url: '', authName: '', authValue: '' };

export function MCPServersPanel() {
  const hook = useMCPServers();
  const run = useAction();
  // remove 是破坏性动作 → 成功/失败都用 toast 收尾（失败不再静默：删除没生效 owner 必须知道）。
  const removeWithToast = useCallback(
    (id: string) => run(() => hook.remove(id), { success: 'Server removed' }),
    [hook, run],
  );
  return (
    <section
      className="crosshair border border-(--color-rule) rounded-sm bg-(--color-surface)/30 p-5"
      data-testid="mcp-servers-panel"
    >
      <span className="ch-tl" /><span className="ch-br" />
      <Head count={hook.servers.length} />
      <Intro />
      <ServerList servers={hook.servers} onRemove={removeWithToast} onCheck={hook.check} />
      <AddForm hook={hook} />
    </section>
  );
}

function Head({ count }: { count: number }) {
  const t = useTranslations('adminIntegrations.mcpServers');
  return (
    <AdminSectionHead className="mb-2" aside={t('count', { count: String(count) })}>
      {t('heading')}
    </AdminSectionHead>
  );
}

function Intro() {
  const t = useTranslations('adminIntegrations.mcpServers');
  return (
    <p className="reading-tight text-[12.5px] text-(--color-muted) italic mb-4">
      {t('intro')}
    </p>
  );
}

function ServerList({
  servers, onRemove, onCheck,
}: {
  servers: readonly MCPServerView[];
  onRemove: (id: string) => Promise<void>;
  onCheck: (id: string) => Promise<MCPProbe>;
}) {
  return servers.length === 0
    ? <ServerListEmpty />
    : (
      <ul className="space-y-2 mb-5" data-testid="mcp-servers-list">
        {servers.map((s) => (
          <ServerRow key={s.id} server={s} onRemove={onRemove} onCheck={onCheck} />
        ))}
      </ul>
    );
}

function ServerListEmpty() {
  const t = useTranslations('adminIntegrations.mcpServers');
  return <p className="mono text-[11.5px] text-(--color-faint) mb-4">{t('empty')}</p>;
}

// Probe —— 这一行「问过没有、问到了什么」。idle 什么都不显示:一台还没问过的 server
// 是**没有证据**,不是「不可达」—— 那两件事不能长一个样。
type Probe =
  | { state: 'idle' }
  | { state: 'asking' }
  | { state: 'answered'; tools: readonly string[] }
  | { state: 'failed'; reason: string };

function ServerRow({
  server, onRemove, onCheck,
}: {
  server: MCPServerView;
  onRemove: (id: string) => Promise<void>;
  onCheck: (id: string) => Promise<MCPProbe>;
}) {
  const [probe, setProbe] = useState<Probe>({ state: 'idle' });
  const ask = useCallback(() => {
    setProbe({ state: 'asking' });
    void runProbe(onCheck, server.id, setProbe);
  }, [onCheck, server.id]);
  return (
    <li
      className="border-b border-(--color-rule)/50 pb-1.5"
      data-testid={`mcp-server-${server.id}`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0">
          <span className="reading text-(--color-ink) text-[14px]">{server.name}</span>
          <span className="mono text-[11px] text-(--color-muted) ml-2 break-all">{server.url}</span>
          <AuthBadge name={server.auth_header_name} />
        </span>
        <span className="flex items-baseline gap-3 shrink-0">
          <RowAction
            testid="mcp-server-check"
            labelKey={probe.state === 'asking' ? 'checking' : 'check'}
            disabled={probe.state === 'asking'}
            onClick={ask}
            tone="muted"
          />
          <RowAction
            testid={`mcp-server-delete-${server.id}`}
            labelKey="remove"
            onClick={() => { void onRemove(server.id); }}
            tone="accent"
          />
        </span>
      </div>
      <ProbeLine probe={probe} />
    </li>
  );
}

async function runProbe(
  onCheck: (id: string) => Promise<MCPProbe>, id: string, set: (p: Probe) => void,
): Promise<void> {
  try {
    const res = await onCheck(id);
    set({ state: 'answered', tools: res.tools });
  } catch (e) {
    set({ state: 'failed', reason: e instanceof Error ? e.message : 'could not reach it' });
  }
}

// ProbeLine —— 探针的回执。**说出真结果**:答上了报工具名(owner 要认的是「这是不是我
// 想挂的那一台」,数量认不出来),没答上报真原因。「点了没反应」是这一行以前的样子。
function ProbeLine({ probe }: { probe: Probe }) {
  return probe.state === 'idle' ? null : <ProbeSaid probe={probe} />;
}

type SaidProbe = Exclude<Probe, { state: 'idle' }>;
type DoneProbe = Exclude<SaidProbe, { state: 'asking' }>;

function ProbeSaid({ probe }: { probe: SaidProbe }) {
  return probe.state === 'asking' ? <ProbeAsking /> : <ProbeDone probe={probe} />;
}

function ProbeDone({ probe }: { probe: DoneProbe }) {
  return probe.state === 'failed'
    ? <ProbeFailed reason={probe.reason} />
    : <ProbeAnswered tools={probe.tools} />;
}

// ProbeAsking 挂**自己**的 testid:「正在问」不是一个结果。共用 `check-result` 的话,
// 那个名字就会在还没有答案的时候指着一句进行时(同 [[names-that-lie]])。
function ProbeAsking() {
  const t = useTranslations('adminIntegrations.mcpServers');
  return (
    <p
      data-testid="mcp-server-check-pending"
      className="mono text-[10.5px] mt-1 text-(--color-faint)"
    >
      {t('checking')}
    </p>
  );
}

function ProbeFailed({ reason }: { reason: string }) {
  const t = useTranslations('adminIntegrations.mcpServers');
  return <ProbeText tone="accent">{t('checkFailed', { reason })}</ProbeText>;
}

function ProbeAnswered({ tools }: { tools: readonly string[] }) {
  const t = useTranslations('adminIntegrations.mcpServers');
  return (
    <ProbeText tone="muted">
      {t('checkTools', { count: tools.length })}
      <ToolNames tools={tools} />
    </ProbeText>
  );
}

// ProbeText —— 探针**答完之后**那一行(成功或失败)。进行时不走这里。
function ProbeText({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <p
      data-testid="mcp-server-check-result"
      className={`mono text-[10.5px] mt-1 break-all ${toneClass(tone)}`}
    >
      {children}
    </p>
  );
}

function ToolNames({ tools }: { tools: readonly string[] }) {
  return tools.length === 0 ? null : <span>{` · ${tools.join(', ')}`}</span>;
}

type Tone = 'muted' | 'accent';

function toneClass(tone: Tone): string {
  return tone === 'accent' ? 'text-(--color-accent)' : 'text-(--color-faint)';
}

// RowAction —— 一行右侧的动作。check 跟 remove 长一个样(mono 小字),因为它们是同一类
// 东西:对这一行的直接操作。区别只在颜色 —— remove 是破坏性的,所以它是那个红字。
function RowAction({
  testid, labelKey, onClick, tone, disabled = false,
}: {
  testid: string; labelKey: 'check' | 'checking' | 'remove'; onClick: () => void;
  tone: Tone; disabled?: boolean;
}) {
  const t = useTranslations('adminIntegrations.mcpServers');
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testid}
      className={`mono text-[10px] tracking-[0.12em] uppercase hover:underline shrink-0
        disabled:opacity-50 disabled:no-underline ${
        tone === 'accent' ? 'text-(--color-accent)' : 'text-(--color-muted)'}`}
    >
      {t(labelKey)}
    </button>
  );
}

function AuthBadge({ name }: { name: string }) {
  return name === '' ? null : <AuthBadgeText name={name} />;
}

function AuthBadgeText({ name }: { name: string }) {
  const t = useTranslations('adminIntegrations.mcpServers');
  return <span className="mono text-[10px] text-(--color-faint) ml-2">{t('authBadge', { name })}</span>;
}

function AddForm({ hook }: { hook: MCPServersHook }) {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof FormState) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const onAdd = () => { void runAdd(hook, form, setForm, setError); };
  return (
    <div className="space-y-3 border-t border-(--color-rule)/60 pt-4">
      <div className="grid grid-cols-[1fr_1.6fr] gap-3">
        <Field label="name" testid="mcp-server-name" value={form.name}
          onChange={set('name')} placeholder="my-tools" />
        <Field label="url" testid="mcp-server-url" value={form.url}
          onChange={set('url')} placeholder="https://mcp.example.com/mcp" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="auth header name (optional)" testid="mcp-server-auth-name" value={form.authName}
          onChange={set('authName')} placeholder="Authorization" />
        <Field label="auth header value (optional)" testid="mcp-server-auth-value" value={form.authValue}
          onChange={set('authValue')} placeholder="Bearer …" type="password" />
      </div>
      <AddButton disabled={addDisabled(form)} onAdd={onAdd} />
      <AddError error={error} />
    </div>
  );
}

function addDisabled(form: FormState): boolean {
  return form.name.trim() === '' || form.url.trim() === '';
}

async function runAdd(
  hook: MCPServersHook, form: FormState,
  setForm: (f: FormState) => void, setError: (e: string | null) => void,
): Promise<void> {
  setError(null);
  const res = await hook.create(toInput(form));
  res.ok ? setForm(EMPTY) : setError(res.error ?? 'Could not add MCP server');
}

function toInput(form: FormState): CreateMCPServerInput {
  return {
    name: form.name.trim(),
    url: form.url.trim(),
    auth_header_name: form.authName.trim(),
    auth_header_value: form.authValue,
  };
}

function AddButton({ disabled, onAdd }: { disabled: boolean; onAdd: () => void }) {
  const t = useTranslations('adminIntegrations.mcpServers');
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onAdd}
      data-testid="mcp-server-add"
      // ADD 是这一段唯一的提交动作，跟 GENERATE / SAVE 是同一类，所以长一个样（UX-76②）。
      // 原来挂 ghost（灰字无边框）—— 在一排填好的输入框旁边读起来像被禁用了。
      className="sm-btn sm-btn-solid sm-btn-sm"
    >
      {t('add')}
    </button>
  );
}

function AddError({ error }: { error: string | null }) {
  return error === null
    ? null
    : <p className="mono text-[11.5px] text-(--color-accent)" data-testid="mcp-server-error">{error}</p>;
}

function Field({
  label, testid, value, onChange, placeholder, type = 'text',
}: {
  label: string; testid: string; value: string;
  onChange: (v: string) => void; placeholder: string; type?: 'text' | 'password';
}) {
  return (
    <label className="block">
      <span className="mono text-[10px] tracking-[0.14em] uppercase text-(--color-muted) block mb-1">
        {label}
      </span>
      <input
        type={type}
        data-testid={testid}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-transparent border-b border-(--color-rule) focus:border-(--color-ink) py-1.5 mono text-[12.5px]"
      />
    </label>
  );
}
