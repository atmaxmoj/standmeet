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
  // captchaToken —— 被锁之后那道人机校验出的票。后端拿它解锁（`code_guard.go`）；
  // 在这之前，这条出路只存在于后端，访客屏幕上什么都没有（F-G-3）。
  const [captchaToken, setCaptchaToken] = useState('');
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
          busy={hook.state.busy}
          shake={shake}
          error={hook.state.error !== null}
          inputRef={inputRef}
          // 被锁住时，票没到手就不让提交：否则访客对着一个看起来正常的按钮反复按，
          // 每次都收到同一句 429，而屏幕上刚出现的那道校验还没出票 —— 他没法知道
          // 差的是等一秒，还是这张码真的没用。
          blocked={hook.state.locked && captchaToken === ''}
        />
        {/* 错误行紧贴出错的那个字段。原来它落在 NameRow **之下**，于是
            `TOO MANY INVALID CODES` 读起来像是「我的名字被拒了」，眼睛得往回跳
            才能把错误跟码输入框对上 —— 而这是访客第一次接触这个产品的一屏（UX-73）。 */}
        <HintStatus busy={hook.state.busy} error={hook.state.error} />
        {/* 锁住之后才出现：没锁时拦一道人机校验，是拿产品的防线去烦正常访客。
            后端本来就认这张票（`code_guard.go`），这里只是把那条出路显出来（F-G-3）。 */}
        <LockedCaptcha locked={hook.state.locked} onToken={setCaptchaToken} />
        <NameRow name={name} setName={setName} />
      </form>
      <Hint />
    </section>
  );
}

// LockedCaptcha —— 被锁之后那道人机校验。两个条件缺一不可：这台实例真配了 captcha
// （否则没有 site key，widget 无从渲染，也没必要），而且这位访客真的被锁了。
function LockedCaptcha(
  { locked, onToken }: { locked: boolean; onToken: (t: string) => void },
) {
  const captcha = useCaptchaSiteKey();
  return locked && captcha.siteKey !== ''
    ? <LockedCaptchaBox siteKey={captcha.siteKey} onToken={onToken} />
    : null;
}

function LockedCaptchaBox(
  { siteKey, onToken }: { siteKey: string; onToken: (t: string) => void },
) {
  const t = useTranslations('gate.codePanel');
  return (
    <div className="space-y-2" data-testid="gate-captcha">
      <p className="mono text-[10.5px] tracking-[0.12em] uppercase text-(--color-muted)">
        {t('captchaHint')}
      </p>
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

// sample —— hint 里示例码 "OAEN-3K2" 的 rich tag。
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

// HintStatus —— 说后端说的那句话。上一版这里收的是一个布尔,于是它**结构上无法**区分
// "这码不存在"(401)和"这码满了"(403,而且信封里带着一句写给访客的话)——不是分支写错了,
// 是信息在类型里就没了(F-A-23)。
function HintStatus({ busy, error }: { busy: boolean; error: string | null }) {
  const t = useTranslations('gate');
  const cls = 'mono text-[10.5px] tracking-[0.16em] uppercase';
  return error !== null ? (
    <p className={`${cls} text-(--color-accent)`} data-testid="gate-error">{error}</p>
  ) : busy ? (
    <p className={`${cls} text-(--color-muted)`}>{t('common.checking')}</p>
  ) : null;
}
