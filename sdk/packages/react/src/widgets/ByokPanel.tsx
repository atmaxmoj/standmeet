// ByokPanel —— the visitor brings their own AI key, inside the AgentWidget. Shown when the owner's
// public quota can't serve (spent, or the provider is rate-limiting). The key is stored encrypted in
// this browser only (sdk-core byoai.ts), sent only with the visitor's own questions, and a byoai
// session reads only what the owner published. Same preset list as the /gate panel.

import React, { useState } from 'react';
import { lookupPreset, PRESETS, type BYOAICredFull } from '@standmeet/sdk-core';
import { useT } from '../i18n.js';

const FIELD = 'w-full bg-transparent border-b border-(--color-rule) focus:border-(--color-accent) outline-none mono text-[12px] text-(--color-ink) py-1';

export function ByokPanel(
  { onUse }: { readonly onUse: (cred: BYOAICredFull) => Promise<void> },
): React.ReactElement {
  const t = useT();
  const [provider, setProvider] = useState('anthropic');
  const [endpoint, setEndpoint] = useState(lookupPreset('anthropic')?.baseUrl ?? '');
  const [model, setModel] = useState('');
  const [key, setKey] = useState('');
  const [failed, setFailed] = useState(false);
  const ready = key.trim().length > 12 && endpoint.trim() !== '' && model.trim() !== '';
  const keyPrefix = lookupPreset(provider)?.keyPrefix;

  const pick = (name: string): void => {
    setProvider(name);
    setEndpoint(lookupPreset(name)?.baseUrl ?? '');
  };
  const submit = (): void => {
    setFailed(false);
    onUse({ provider, endpoint: endpoint.trim(), model: model.trim(), key: key.trim() })
      .catch(() => { setFailed(true); });
  };

  return (
    <form
      data-testid="agent-widget-byok"
      className="mb-4 border border-(--color-rule) rounded-[3px] p-3 flex flex-col gap-2"
      onSubmit={(e) => { e.preventDefault(); if (ready) submit(); }}
    >
      <p className="font-serif text-[15px] text-(--color-muted) leading-[1.5]">{t('byokIntro')}</p>
      <select
        data-testid="agent-widget-byok-provider" aria-label={t('byokProvider')} value={provider}
        onChange={(e) => pick(e.target.value)} className={FIELD}
      >
        {PRESETS.map((p) => <option key={p.name} value={p.name}>{p.label}</option>)}
      </select>
      <input
        data-testid="agent-widget-byok-endpoint" aria-label={t('byokEndpoint')} value={endpoint}
        onChange={(e) => setEndpoint(e.target.value)} placeholder={URL_HINT} className={FIELD}
      />
      <input
        data-testid="agent-widget-byok-model" aria-label={t('byokModel')} value={model}
        onChange={(e) => setModel(e.target.value)} placeholder={t('byokModelPlaceholder')} className={FIELD}
      />
      <input
        data-testid="agent-widget-byok-key" aria-label={t('byokKey')} type="password" value={key}
        autoComplete="new-password" onChange={(e) => setKey(e.target.value)}
        placeholder={keyPrefix ? `${keyPrefix}…` : t('byokKey')}
        className={FIELD}
      />
      {failed && (
        <p className="mono text-[11px] text-(--color-accent)">{t('byokSaveFailed')}</p>
      )}
      <button
        type="submit" data-testid="agent-widget-byok-submit" disabled={!ready}
        className="self-end mono text-[11px] tracking-[0.14em] uppercase text-(--color-accent) disabled:opacity-40"
      >
        {t('byokSubmit')}
      </button>
    </form>
  );
}

// A URL shape, not a word.
const URL_HINT = 'https://…';
