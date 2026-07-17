// MCPServersPanel —— owner-registered external MCP servers(agent 出站调的工具)
// 的 CRUD。owner 把别处拿到的 MCP server(URL + 可选 auth header)装载进来,
// 再在 roles 里挂给 access code。后端 /mcp-servers 全 real;auth value 加密落盘。
//
// 跟 connector panel 同视觉(crosshair 卡 + mono kicker)。

'use client';

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';

import { useMCPServers, type CreateMCPServerInput, type MCPServersHook, type MCPServerView } from '@/lib/admin/use-mcp-servers';
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
      <ServerList servers={hook.servers} onRemove={removeWithToast} />
      <AddForm hook={hook} />
    </section>
  );
}

function Head({ count }: { count: number }) {
  const t = useTranslations('adminIntegrations.mcpServers');
  return (
    <div className="flex items-baseline justify-between mb-2">
      <h3 className="mono text-[10.5px] tracking-[0.14em] uppercase text-(--color-muted)">
        {t('heading')}
      </h3>
      <span className="mono text-[10.5px] text-(--color-faint)">{t('count', { count: String(count) })}</span>
    </div>
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
  servers, onRemove,
}: { servers: readonly MCPServerView[]; onRemove: (id: string) => Promise<void> }) {
  return servers.length === 0
    ? <ServerListEmpty />
    : (
      <ul className="space-y-2 mb-5" data-testid="mcp-servers-list">
        {servers.map((s) => <ServerRow key={s.id} server={s} onRemove={onRemove} />)}
      </ul>
    );
}

function ServerListEmpty() {
  const t = useTranslations('adminIntegrations.mcpServers');
  return <p className="mono text-[11.5px] text-(--color-faint) mb-4">{t('empty')}</p>;
}

function ServerRow({
  server, onRemove,
}: { server: MCPServerView; onRemove: (id: string) => Promise<void> }) {
  const t = useTranslations('adminIntegrations.mcpServers');
  return (
    <li
      className="flex items-baseline justify-between gap-3 border-b border-(--color-rule)/50 pb-1.5"
      data-testid={`mcp-server-${server.id}`}
    >
      <span className="min-w-0">
        <span className="reading text-(--color-ink) text-[14px]">{server.name}</span>
        <span className="mono text-[11px] text-(--color-muted) ml-2 break-all">{server.url}</span>
        <AuthBadge name={server.auth_header_name} />
      </span>
      <button
        type="button"
        onClick={() => { void onRemove(server.id); }}
        data-testid={`mcp-server-delete-${server.id}`}
        className="mono text-[10px] tracking-[0.12em] uppercase text-(--color-accent) hover:underline shrink-0"
      >
        {t('remove')}
      </button>
    </li>
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
      className="sm-btn sm-btn-ghost sm-btn-sm"
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
