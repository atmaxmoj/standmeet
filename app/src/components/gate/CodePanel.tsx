// CodePanel —— gate Hero 里的 code + 名字输入栏。
//
// 同一个 code 可以发给多人，所以 owner 区分访客靠"输入名字"。一个 (code,
// display_name) 唯一定位 member；后端 GetOrCreateCodeMember upsert。访客填
// 完两个字段才提交，name 留空走 "anonymous" 路径（实际后端会创一个
// is_anonymous=true 的 row）。
//
// v5 design polish (docs/design/project/gate.js CodeInput)：
// - 大写归一化 + 只留 [A-Z0-9-]，长度上限 32
// - paste 触发自动提交（粘贴看似 code-shaped 时 50ms 后 submit）
// - 错码 → shake + 清空 + refocus
// - "checking…" / "unknown code" / hint 三态文案

'use client';

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import type { GateHook } from '@/lib/gate/use-gate';
import {
  codeReady,
  handlePasteEvent,
  normalizeCode,
  scheduleAutoSubmit,
  submitCodeAndGo,
} from '@/lib/gate/code-panel-logic';
import { useShakeOnError } from '@/lib/gate/use-shake-on-error';

type Props = {
  hook: GateHook;
};

export function CodePanel({ hook }: Props) {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  // 错码 / 网络挂 → 0.4s shake → 清空 + refocus。
  const shake = useShakeOnError(hook.state.error, () => {
    setCode('');
    inputRef.current?.focus();
  });

  const onSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = code.trim();
    trimmed !== ''
      && (await submitCodeAndGo(trimmed, name, { router, hook }));
  }, [code, name, hook, router]);

  const onPaste = useCallback((e: React.ClipboardEvent<HTMLInputElement>) => {
    handlePasteEvent(e, (normalized) => {
      setCode(normalized);
      scheduleAutoSubmit(normalized, name, { router, hook });
    });
  }, [name, hook, router]);

  return (
    <section data-testid="code-panel">
      <form onSubmit={onSubmit} className="space-y-3">
        <CodeRow
          code={code}
          setCode={(v) => setCode(normalizeCode(v))}
          onPaste={onPaste}
          busy={hook.state.busy}
          shake={shake}
          error={hook.state.error !== null}
          inputRef={inputRef}
        />
        <NameRow name={name} setName={setName} />
      </form>
      <Hint busy={hook.state.busy} error={hook.state.error !== null} />
    </section>
  );
}

function CodeRow(props: {
  code: string;
  setCode: (v: string) => void;
  onPaste: (e: React.ClipboardEvent<HTMLInputElement>) => void;
  busy: boolean;
  shake: boolean;
  error: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <div className={`flex items-baseline gap-3 ${props.shake ? 'shake' : ''}`}>
      <CodeInput {...props} />
      <CodeEnterBtn busy={props.busy} enabled={codeReady(props.code)} />
    </div>
  );
}

function CodeInput(props: {
  code: string;
  setCode: (v: string) => void;
  onPaste: (e: React.ClipboardEvent<HTMLInputElement>) => void;
  busy: boolean;
  error: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <input
      ref={props.inputRef}
      type="text"
      inputMode="text"
      value={props.code}
      onChange={(e) => props.setCode(e.target.value)}
      onPaste={props.onPaste}
      placeholder="LABEL-NNN"
      disabled={props.busy}
      autoComplete="one-time-code"
      spellCheck={false}
      data-testid="gate-code"
      className={inputCls(props.error)}
    />
  );
}

function inputCls(error: boolean): string {
  const base = 'flex-1 min-w-0 bg-transparent mono uppercase text-[24px] tracking-[0.08em] py-3 border-b-[1.5px] focus:outline-none transition-colors';
  return error
    ? `${base} text-(--color-accent) border-(--color-accent)`
    : `${base} text-(--color-ink) border-(--color-ink) placeholder:text-(--color-faint)`;
}

function CodeEnterBtn({ busy, enabled }: { busy: boolean; enabled: boolean }) {
  return (
    <button
      type="submit"
      disabled={busy || !enabled}
      data-testid="gate-code-submit"
      className="mono text-[10.5px] tracking-[0.16em] uppercase text-(--color-paper) bg-(--color-ink) px-3.5 py-2.5 hover:bg-(--color-accent) disabled:opacity-40 transition-colors shrink-0"
    >
      {busy ? 'checking…' : <CodeEnterLabel />}
    </button>
  );
}

function CodeEnterLabel() {
  return (
    <>
      enter <span className="text-[12px]">↵</span>
    </>
  );
}

function NameRow({ name, setName }: { name: string; setName: (v: string) => void }) {
  return (
    <div className="flex items-baseline gap-3 py-2 border-b border-(--color-rule)">
      <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) shrink-0">
        your name
      </span>
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g. Sarah (Acme HR)"
        data-testid="gate-visitor-name"
        spellCheck={false}
        autoComplete="off"
        className="flex-1 bg-transparent reading-tight text-[15px] text-(--color-ink) placeholder:text-(--color-faint) min-w-0"
      />
    </div>
  );
}

function Hint({ busy, error }: { busy: boolean; error: boolean }) {
  return (
    <div className="mono text-[10.5px] tracking-[0.12em] mt-4 leading-[1.7] max-w-[44em]">
      <HintStatus busy={busy} error={error} />
      <p className="text-(--color-faint)">
        codes look like <span className="text-(--color-muted)">OAEN-3K2</span> · they arrive by
        email from the owner directly · case doesn&rsquo;t matter · paste the whole thing (with
        or without the dash) and press enter.
      </p>
      <p className="text-(--color-faint) mt-1">
        your name lets the owner separate visitors who share the same code.
      </p>
    </div>
  );
}

function HintStatus({ busy, error }: { busy: boolean; error: boolean }) {
  return error ? (
    <p className="text-(--color-accent) mb-1 tracking-[0.16em] uppercase">unknown code</p>
  ) : busy ? (
    <p className="text-(--color-muted) mb-1 tracking-[0.16em] uppercase">checking…</p>
  ) : null;
}
