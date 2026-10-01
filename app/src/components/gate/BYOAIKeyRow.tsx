// BYOAIKeyRow — the "API KEY" field in the gate's BYOAI panel: the shared SecretInput (its eye)
// + shape hint.
// Split out of BYOAIPanel to satisfy check-max-lines; that file keeps the assembly,
// this file is this field's own behavior.

'use client';

import { useTranslations } from 'next-intl';

import { SecretInput } from '@/components/atoms/SecretInput';

export function KeyRow({
  value, onChange, placeholder, keyPrefix,
}: {
  value: string; onChange: (v: string) => void;
  placeholder: string;
  // keyPrefix — what this provider's key looks like (declared by the preset;
  // empty = self-hosted endpoint, don't check shape).
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
      <SecretInput
        testid="byoai-key" value={value} onChange={onChange} placeholder={placeholder}
        className="sm-field-input sm-mono"
      />
      <KeyShapeHint value={value} prefix={keyPrefix} />
    </>
  );
}

// KeyShapeHint — say something when the shape doesn't look like this provider's key.
//
// The `keyPrefix` comment in the preset says "sanity check", but nothing in the repo
// actually checks it — it declares a slot no one wires up (F-O-4). When a visitor
// pastes the wrong key, they'd otherwise wait until it lands in a conversation, the
// first question fails, and only then — three steps away — see a provider error.
// The field they can actually fix is right here.
//
// **Hint only, never block**: a self-hosted endpoint (ollama / vllm / lm-studio) key
// can look like anything, so making this a hard validation would block legitimate
// configs — that would be worse than the status quo. The submit key stays clickable
// at all times; a test pins this in both directions.
function KeyShapeHint({ value, prefix }: { value: string; prefix: string }) {
  return shapeLooksOff(value, prefix) ? <KeyShapeHintLine prefix={prefix} /> : null;
}

// shapeLooksOff — there's a declared prefix, the visitor actually typed something,
// and it doesn't start with that prefix. Miss any of the three and stay quiet:
// don't nag on an empty field, and don't check shape for a self-hosted endpoint
// (empty prefix).
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
