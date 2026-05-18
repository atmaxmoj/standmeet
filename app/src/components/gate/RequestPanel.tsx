// RequestPanel —— /<handle>/gate 第三栏：access 申请表单。
// stub：POST /api/v1/access-requests（后端落 audit log）。

'use client';

import { useCallback, useState } from 'react';

import type { AccessRequestInput, GateHook } from '@/lib/gate/use-gate';

type Props = {
  handle: string;
  hook: GateHook;
};

export function RequestPanel({ handle, hook }: Props) {
  const [form, setForm] = useState({ email: '', name: '', message: '' });
  const [sent, setSent] = useState(false);

  const setField = useCallback((key: keyof typeof form, v: string) => {
    setForm((prev) => ({ ...prev, [key]: v }));
  }, []);

  const onSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const input: AccessRequestInput = { handle, ...form };
    const ok = await hook.submitRequest(input);
    setSent(ok);
  }, [form, handle, hook]);

  return (
    <section className="rise" data-testid="request-panel">
      <PanelHeader />
      <RequestBody sent={sent} form={form} setField={setField} onSubmit={onSubmit} busy={hook.state.busy} />
    </section>
  );
}

function PanelHeader() {
  return (
    <header>
      <div className="mono text-[10px] tracking-[0.2em] uppercase text-(--color-muted)">
        need an invite?
      </div>
      <p className="reading italic text-(--color-muted) mt-2 text-base">
        Tell the owner who you are and what you&apos;d like to discuss.
      </p>
    </header>
  );
}

function RequestBody({
  sent, form, setField, onSubmit, busy,
}: {
  sent: boolean;
  form: { email: string; name: string; message: string };
  setField: (k: 'email' | 'name' | 'message', v: string) => void;
  onSubmit: (e: React.FormEvent) => Promise<void>;
  busy: boolean;
}) {
  return sent
    ? <SentConfirmation />
    : <RequestForm form={form} setField={setField} onSubmit={onSubmit} busy={busy} />;
}

function SentConfirmation() {
  return (
    <p className="reading text-(--color-muted) mt-6" data-testid="request-sent">
      Got it — you&apos;ll hear back if the owner replies.
    </p>
  );
}

function RequestForm({
  form, setField, onSubmit, busy,
}: {
  form: { email: string; name: string; message: string };
  setField: (k: 'email' | 'name' | 'message', v: string) => void;
  onSubmit: (e: React.FormEvent) => Promise<void>;
  busy: boolean;
}) {
  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-4">
      <TextField label="email" testid="request-email" value={form.email} onChange={(v) => setField('email', v)} />
      <TextField label="name" testid="request-name" value={form.name} onChange={(v) => setField('name', v)} />
      <TextArea label="message" testid="request-message" value={form.message} onChange={(v) => setField('message', v)} />
      <button
        type="submit"
        disabled={busy}
        data-testid="request-submit"
        className="mono text-xs tracking-widest uppercase text-(--color-paper) bg-(--color-ink) px-4 py-2.5 disabled:opacity-40"
      >
        {busy ? 'sending…' : 'request access ↵'}
      </button>
    </form>
  );
}

function TextField({
  label, testid, value, onChange,
}: {
  label: string;
  testid: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-2">{label}</div>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-testid={testid}
        className="w-full bg-transparent border-b border-(--color-rule) focus:border-(--color-ink) py-2 reading text-base"
      />
    </label>
  );
}

function TextArea({
  label, testid, value, onChange,
}: {
  label: string;
  testid: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-2">{label}</div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        data-testid={testid}
        className="w-full bg-transparent border border-(--color-rule) focus:border-(--color-ink) p-2 reading text-base"
      />
    </label>
  );
}
