// MCPServersPanel — CRUD for owner-registered external MCP servers (tools
// the agent calls outbound). owner loads in an MCP server obtained elsewhere
// (URL + optional auth header), then attaches it to an access code via
// roles. The `/mcp-servers` backend is fully real; auth value is encrypted
// at rest.
//
// Same visual language as the connector panel (crosshair card + mono
// kicker).
//
// Each row also carries a **read-only probe** (check): ask that server
// whether it answers and what tools it has. Without it, all the evidence
// on an ext-MCP row is the URL owner himself pasted in (F-D-8).

'use client';

import { useCallback, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';

import { AdminSectionHead } from '@/components/admin/AdminSectionHead';
import { APIError } from '@/lib/api/api-error';
import { ListPane } from '@/components/admin/ListPane';
import { useMCPServers, type CreateMCPServerInput, type MCPProbe, type MCPServersHook, type MCPServerView } from '@/lib/admin/use-mcp-servers';
import { useAction } from '@/lib/ui/use-action';

type FormState = Record<'name' | 'url' | 'authName' | 'authValue', string>;
const EMPTY: FormState = { name: '', url: '', authName: '', authValue: '' };

export function MCPServersPanel() {
  const hook = useMCPServers();
  const run = useAction();
  // remove is a destructive action → both success and failure end in a
  // toast (failure is no longer silent: owner must know a delete didn't
  // take).
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
      <ListPane status={hook.status} count={hook.servers.length} empty={<ServerListEmpty />}>
        <ServerList servers={hook.servers} onRemove={removeWithToast} onCheck={hook.check} />
      </ListPane>
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
  return (
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

// Probe — "was it asked, and what did it answer" for this row. idle shows
// nothing at all: a server that was never asked is **no evidence**, not
// "unreachable" — the two must never look the same.
type Probe =
  | { state: 'idle' }
  | { state: 'asking' }
  | { state: 'answered'; tools: readonly string[] }
  | { state: 'failed'; reason: string; code: string };

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
    set(probeFailure(e));
  }
}

// probeFailure — reads a thrown value as "it failed, for what reason, of
// what kind". An empty code means it wasn't the API answering (e.g. network
// down), and then reason is all there is to say.
function probeFailure(e: unknown): Probe {
  return {
    state: 'failed',
    reason: e instanceof Error ? e.message : 'could not reach it',
    code: e instanceof APIError ? e.code : '',
  };
}

// ProbeLine — the probe's receipt. **State the real result**: if it
// answered, report tool names (owner needs to recognize "is this the one I
// meant to attach", a count alone doesn't let him); if it didn't answer,
// report the real reason. "Clicked and nothing happened" is what this row
// used to look like.
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
    ? <ProbeFailed reason={probe.reason} code={probe.code} />
    : <ProbeAnswered tools={probe.tools} />;
}

// ProbeAsking gets **its own** testid: "asking" is not a result. Sharing
// `check-result` would point that name at an in-progress sentence before
// there's any answer yet (same failure as [[names-that-lie]]).
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

// ProbeFailed — failures come in kinds, and owner's next move differs by
// kind (F-D-15): credential rejected → go fix the token; no one answered →
// go fix the URL. **Branch on code, not on message text** — matching
// sentence text would silently fall back to the default line the moment the
// server rewords its message. The default line stays: for an unrecognized
// code, telling the real reason is still better than saying "something
// went wrong".
const PROBE_SAID: Record<string, string> = {
  mcp_server_refused_auth: 'checkRefused',
  mcp_server_no_answer: 'checkNoAnswer',
};

function ProbeFailed({ reason, code }: { reason: string; code: string }) {
  const t = useTranslations('adminIntegrations.mcpServers');
  const key = PROBE_SAID[code];
  return (
    <ProbeText tone="accent">
      {key === undefined ? t('checkFailed', { reason }) : t(key)}
    </ProbeText>
  );
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

// ProbeText — the row shown **after the probe finishes** (success or
// failure). The in-progress state never goes through here.
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

// RowAction — the action on the right of a row. check and remove look the
// same (small mono text) because they're the same category of thing: a
// direct action on this row. The only difference is color — remove is
// destructive, so it gets the accent (red) text.
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
      // ADD is the one submit action in this section, same category as
      // GENERATE / SAVE, so it looks the same (UX-76②). It used to be
      // ghost-styled (gray text, no border) — next to a row of filled-in
      // inputs that read as disabled.
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
        className="sm-field-input sm-mono"
      />
    </label>
  );
}
