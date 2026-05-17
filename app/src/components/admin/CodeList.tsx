// CodeList —— /admin/codes section 内容。最小 M8 版：create + list。

'use client';

import { useCallback, useState } from 'react';

import { SectionHeader } from './SectionHeader';

import { useCodes, type CodesHook, type CodeView } from '@/lib/admin/use-codes';

export function CodeList() {
  const hook = useCodes();
  return (
    <>
      <SectionHeader title="codes" subtitle="LABEL-XXX access codes you hand out to specific visitors" />
      <CodeBody hook={hook} />
    </>
  );
}

function CodeBody({ hook }: { hook: CodesHook }) {
  return hook.state.kind === 'loading' ? <Loading />
    : hook.state.kind === 'error' ? <ErrorMsg message={hook.state.message} />
    : <Ready hook={hook} state={hook.state} />;
}

function Loading() {
  return <p className="mono text-(--color-muted)">loading…</p>;
}

function ErrorMsg({ message }: { message: string }) {
  return <p className="mono text-(--color-accent)">{message}</p>;
}

function Ready({
  hook, state,
}: {
  hook: CodesHook;
  state: Extract<CodesHook['state'], { kind: 'ready' }>;
}) {
  return (
    <div className="space-y-8">
      <CreateCodeForm createCode={hook.createCode} error={state.error} />
      <CodesView codes={state.codes} />
    </div>
  );
}

function CreateCodeForm({
  createCode, error,
}: {
  createCode: CodesHook['createCode'];
  error: string | null;
}) {
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [tags, setTags] = useState('');

  const onSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const ready = code.trim() !== '' && label.trim() !== '';
    ready && (await submitCreate(code, label, tags, createCode, setCode, setLabel, setTags));
  }, [code, label, tags, createCode]);

  return (
    <form onSubmit={onSubmit} className="space-y-4" data-testid="code-form">
      <FormField label="code" testid="code-input" value={code} onChange={setCode} placeholder="INTRO-001" />
      <FormField label="label" testid="code-label" value={label} onChange={setLabel} placeholder="Intro for HR" />
      <FormField label="included_tags (comma-separated)" testid="code-tags" value={tags} onChange={setTags} placeholder="intro, work" />
      <CreateError message={error} />
      <button
        type="submit"
        data-testid="code-create"
        className="mono text-xs tracking-widest uppercase text-(--color-paper) bg-(--color-ink) px-4 py-2.5"
      >
        create
      </button>
    </form>
  );
}

function FormField({
  label, testid, value, onChange, placeholder,
}: {
  label: string;
  testid: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <label className="block">
      <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-1">{label}</div>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        data-testid={testid}
        className="w-full bg-transparent border-b border-(--color-rule) focus:border-(--color-ink) py-2 reading"
      />
    </label>
  );
}

function CreateError({ message }: { message: string | null }) {
  return message ? <p className="mono text-xs text-(--color-accent)">{message}</p> : null;
}

function CodesView({ codes }: { codes: CodeView[] }) {
  return codes.length === 0
    ? <p className="reading italic text-(--color-muted)">No codes yet.</p>
    : (
      <ul className="space-y-3" data-testid="code-list">
        {codes.map((c) => <CodeRow key={c.id} code={c} />)}
      </ul>
    );
}

function CodeRow({ code }: { code: CodeView }) {
  return (
    <li className="border-b border-(--color-rule) pb-3" data-testid={`code-row-${code.code}`}>
      <div className="reading">{code.code} <span className="text-(--color-muted)">· {code.label}</span></div>
      <div className="mono text-[10px] text-(--color-muted) mt-1">
        scope: {code.included_tags.join(', ') || '(unrestricted)'} · status: {code.status}
      </div>
    </li>
  );
}

async function submitCreate(
  code: string, label: string, tags: string,
  createCode: CodesHook['createCode'],
  setCode: (v: string) => void,
  setLabel: (v: string) => void,
  setTags: (v: string) => void,
): Promise<void> {
  const included = tags.split(',').map((t) => t.trim()).filter((t) => t !== '');
  await createCode({ code: code.trim(), label: label.trim(), included_tags: included });
  setCode(''); setLabel(''); setTags('');
}
