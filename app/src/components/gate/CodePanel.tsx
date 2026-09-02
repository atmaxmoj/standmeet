// CodePanel — the code + name input row in the gate Hero.
//
// The same code can be handed to multiple people, so the owner tells visitors apart
// by "typed name". A (code, display_name) pair uniquely locates a member; the
// backend's GetOrCreateCodeMember upserts it. The visitor fills both fields before
// submitting; leaving name blank takes the "anonymous" path (the backend actually
// creates a row with is_anonymous=true).
//
// v5 design polish (docs/design/project/gate.js CodeInput):
// - Uppercase-normalize + keep only [A-Z0-9-], max length 32
// - Paste triggers auto-submit (submits 50ms after a paste that looks code-shaped)
// - Wrong code -> shake + clear + refocus
// - Three-state copy: "checking…" / "unknown code" / hint

'use client';

import { useCallback, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { TurnstileWidget } from '@/components/auth/TurnstileWidget';
import { useCaptchaSiteKey } from '@/lib/auth/use-captcha-site-key';
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
  // captchaToken — the ticket issued by the human-verification challenge that
  // appears after being locked. The backend uses it to unlock (`code_guard.go`);
  // before this ticket exists, that path lives only on the backend — the visitor's
  // screen shows nothing (F-G-3).
  const [captchaToken, setCaptchaToken] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Wrong code / network failure -> 0.4s shake -> clear + refocus.
  const shake = useShakeOnError(hook.code.error, () => {
    setCode('');
    inputRef.current?.focus();
  });

  const onSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = code.trim();
    trimmed !== ''
      && (await submitCodeAndGo(trimmed, name, { router, hook }, captchaToken));
  }, [code, name, hook, router, captchaToken]);

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
          busy={hook.code.busy}
          shake={shake}
          error={hook.code.error !== null}
          inputRef={inputRef}
          // When locked, don't allow submit until the ticket is in hand: otherwise
          // the visitor keeps clicking a button that looks normal, gets the same
          // 429 every time, and the challenge that just appeared hasn't issued a
          // ticket yet — they can't tell whether they just need to wait a second
          // or the code is truly dead.
          blocked={hook.code.locked && captchaToken === ''}
        />
        {/* The error line sits right against the field that caused it. It used to
            sit **below** NameRow, so "TOO MANY INVALID CODES" read as if it were
            rejecting the visitor's name — the eye had to jump back up to connect
            the error to the code input, on the very first screen a visitor sees
            of this product (UX-73). */}
        <HintStatus busy={hook.code.busy} error={hook.code.error} />
        {/* Appears only once locked: showing a human-verification challenge before
            that would make normal visitors run the product's defense for nothing.
            The backend already accepts this ticket (`code_guard.go`); this just
            surfaces that path (F-G-3). */}
        <LockedCaptcha locked={hook.code.locked} onToken={setCaptchaToken} />
        <NameRow name={name} setName={setName} />
      </form>
      <Hint />
    </section>
  );
}

// LockedCaptcha — the human-verification challenge that appears after being locked.
// Both conditions are required: this instance actually has captcha configured
// (otherwise there's no site key, the widget can't render, and it's unneeded), and
// this visitor is actually locked.
function LockedCaptcha(
  { locked, onToken }: { locked: boolean; onToken: (t: string) => void },
) {
  const captcha = useCaptchaSiteKey();
  return locked && captcha.siteKey !== ''
    ? <LockedCaptchaBox siteKey={captcha.siteKey} onToken={onToken} />
    : null;
}

// LockedCaptchaBox — just the challenge widget, no explanation text of its own. The
// explanation comes from **the backend's rejection message** (`HintStatus` sits
// right above it): that message arrives with the rejection itself, and it knows
// whether this instance even offers this path out. Writing another sentence here
// would put two differently-worded sentences on screen saying the same thing, with
// the widget wedged between them.
function LockedCaptchaBox(
  { siteKey, onToken }: { siteKey: string; onToken: (t: string) => void },
) {
  return (
    <div data-testid="gate-captcha">
      <TurnstileWidget siteKey={siteKey} onToken={onToken} />
    </div>
  );
}

function CodeRow(props: {
  code: string;
  setCode: (v: string) => void;
  onPaste: (e: React.ClipboardEvent<HTMLInputElement>) => void;
  busy: boolean;
  shake: boolean;
  error: boolean;
  blocked: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <div className={`flex items-baseline gap-3 ${props.shake ? 'shake' : ''}`}>
      <CodeInput {...props} />
      <CodeEnterBtn busy={props.busy} enabled={codeReady(props.code) && !props.blocked} />
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
  const t = useTranslations('gate.common');
  return (
    <button
      type="submit"
      disabled={busy || !enabled}
      data-testid="gate-code-submit"
      className="mono text-[10.5px] tracking-[0.16em] uppercase text-(--color-paper) bg-(--color-ink) px-3.5 py-2.5 hover:bg-(--color-accent) disabled:opacity-40 transition-colors shrink-0"
    >
      {busy ? t('checking') : <CodeEnterLabel />}
    </button>
  );
}

function CodeEnterLabel() {
  const t = useTranslations('gate.codePanel');
  return (
    <>
      {t('enter')} <span className="text-[12px]">↵</span>
    </>
  );
}

function NameRow({ name, setName }: { name: string; setName: (v: string) => void }) {
  const t = useTranslations('gate.common');
  return (
    <div className="flex items-baseline gap-3 py-2 border-b border-(--color-rule)">
      <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) shrink-0">
        {t('yourName')}
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

// sample — the rich tag for the example code "OAEN-3K2" in the hint.
const sample = (chunks: ReactNode) => <span className="text-(--color-muted)">{chunks}</span>;

function Hint() {
  const t = useTranslations('gate.codePanel');
  return (
    <div className="mono text-[10.5px] tracking-[0.12em] mt-4 leading-[1.7] max-w-[44em]">
      <p className="text-(--color-faint)">
        {t.rich('hint', { sample })}
      </p>
      <p className="text-(--color-faint) mt-1">
        {t('nameHint')}
      </p>
    </div>
  );
}

// HintStatus — says whatever the backend said. The previous version took a boolean
// here, so it **structurally couldn't** distinguish "this code doesn't exist" (401)
// from "this code is full" (403, with a message for the visitor riding in the
// envelope) — that's not a branch that was written wrong, it's information that
// never survived the type (F-A-23).
function HintStatus({ busy, error }: { busy: boolean; error: string | null }) {
  const t = useTranslations('gate');
  const cls = 'mono text-[10.5px] tracking-[0.16em] uppercase';
  return error !== null ? (
    <p className={`${cls} text-(--color-accent)`} data-testid="gate-error">{error}</p>
  ) : busy ? (
    <p className={`${cls} text-(--color-muted)`}>{t('common.checking')}</p>
  ) : null;
}
