// BYOAIKeyRow —— gate 的 BYOAI 面板里「API KEY」那一格：输入 + 显示/隐藏 + 形状提示。
// 从 BYOAIPanel 拆出来守 check-max-lines；那边留装配，这边是这一格自己的行为。

'use client';

import { useTranslations } from 'next-intl';

export function KeyRow({
  value, onChange, reveal, onToggleReveal, placeholder, keyPrefix,
}: {
  value: string; onChange: (v: string) => void;
  reveal: boolean; onToggleReveal: () => void;
  placeholder: string;
  // keyPrefix —— 这家 provider 的 key 长什么样（preset 声明；空 = 自建端点，不判形状）。
  keyPrefix: string;
}) {
  const t = useTranslations('gate.byoai');
  return (
    <>
      <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-2 flex items-baseline justify-between">
        <span>{t('apiKey')}</span>
        <span className="text-(--color-faint) lowercase tracking-[0.06em] text-[10px]">
          {t('keyNote')}
        </span>
      </div>
      <div className="flex items-baseline gap-3 border-b border-(--color-rule) pb-1">
        <input
          type={reveal ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          data-testid="byoai-key"
          autoComplete="new-password"
          spellCheck={false}
          className="flex-1 bg-transparent mono py-2 reading text-(--color-ink) placeholder:text-(--color-faint) text-[15.5px] tracking-[0.02em]"
        />
        <button
          type="button"
          onClick={onToggleReveal}
          className="mono text-[10px] tracking-[0.12em] uppercase text-(--color-faint) hover:text-(--color-ink) shrink-0"
        >
          {reveal ? t('hide') : t('reveal')}
        </button>
      </div>
      <KeyShapeHint value={value} prefix={keyPrefix} />
    </>
  );
}

// KeyShapeHint —— 形状不像这家 provider 的 key 时说一句。
//
// preset 里那个 `keyPrefix` 的注释写着「sanity check」，而全仓没有一处检查它 —— 声明了一个
// 没人接的位子（F-O-4）。访客把 key 粘错时，本来要等落进对话、问出第一个问题、推理失败，
// 才在三步之外看见一个 provider 的报错；他能修的那一格在这里。
//
// **只提示，不拦**：自建端点（ollama / vllm / lm-studio）的 key 可以长成任何样子，把它做成
// 硬校验会挡住合法配置 —— 那比现在更糟。提交键一直是可按的，这条由测试两个方向钉住。
function KeyShapeHint({ value, prefix }: { value: string; prefix: string }) {
  return shapeLooksOff(value, prefix) ? <KeyShapeHintLine prefix={prefix} /> : null;
}

// shapeLooksOff —— 有声明的前缀、访客真填了东西、而它不是那个开头。三者缺一都不提示：
// 没填别催，自建端点（空前缀）不判形状。
function shapeLooksOff(value: string, prefix: string): boolean {
  const typed = value.trim();
  return prefix !== '' && typed !== '' && !typed.startsWith(prefix);
}

function KeyShapeHintLine({ prefix }: { prefix: string }) {
  const t = useTranslations('gate.byoai');
  return (
    <p
      className="mono text-[10px] tracking-[0.06em] text-(--color-muted) mt-1.5"
      data-testid="byoai-key-hint"
    >
      {t('keyShapeHint', { prefix })}
    </p>
  );
}
