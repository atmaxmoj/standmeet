// BYOAIEditor — enable toggle + provider chips + public blurb.
// Fully client-side state (useBYOAI), no backend persistence.

'use client';

import { useTranslations } from 'next-intl';

import { Chip } from '@/components/admin/atoms/Chip';
import { EditField } from '@/components/admin/sections/page/EditField';
import { useBYOAI, type BYOAIProvider, type BYOAIHook } from '@/lib/admin/use-byoai';

const ALL_PROVIDERS: readonly { id: BYOAIProvider; label: string }[] = [
  { id: 'claude', label: 'Claude (Anthropic)' },
  { id: 'openai', label: 'OpenAI / ChatGPT' },
  { id: 'gemini', label: 'Gemini (Google)' },
];

export function BYOAIEditor() {
  const hook = useBYOAI();
  return (
    <div className="space-y-5">
      <MasterToggle hook={hook} />
      <ProviderPicker hook={hook} />
      <BlurbField hook={hook} />
      <SaveRow hook={hook} />
    </div>
  );
}

function SaveRow({ hook }: { hook: BYOAIHook }) {
  const t = useTranslations('adminPages.byoai');
  return (
    <div className="flex items-baseline justify-between gap-3 pt-2">
      <SaveHint loading={hook.loading} saving={hook.saving} error={hook.error} />
      <button
        type="button"
        onClick={() => { void hook.save(); }}
        disabled={hook.saving || hook.loading}
        className="mono text-[11px] tracking-[0.16em] uppercase px-3.5 py-2 bg-(--color-ink) text-(--color-paper) hover:bg-(--color-accent) transition-colors disabled:opacity-50"
      >
        {hook.saving ? t('saving') : t('save')}
      </button>
    </div>
  );
}

const HINT: Record<'loading' | 'saving' | 'default', { cls: string; key: string }> = {
  loading: { cls: 'text-(--color-faint)', key: 'hintLoading' },
  saving: { cls: 'text-(--color-muted)', key: 'hintSaving' },
  default: { cls: 'text-(--color-faint)', key: 'hintDefault' },
};

function hintKind(loading: boolean, saving: boolean): 'loading' | 'saving' | 'default' {
  return loading ? 'loading' : (saving ? 'saving' : 'default');
}

function SaveHint({
  loading, saving, error,
}: { loading: boolean; saving: boolean; error: string | null }) {
  const t = useTranslations('adminPages.byoai');
  const cfg = HINT[hintKind(loading, saving)];
  return error
    ? <Hint cls="text-(--color-accent)" text={error} />
    : <Hint cls={cfg.cls} text={t(cfg.key)} />;
}

function Hint({ cls, text }: { cls: string; text: string }) {
  return <span className={`mono text-[10px] tracking-[0.12em] ${cls}`}>{text}</span>;
}

function MasterToggle({ hook }: { hook: BYOAIHook }) {
  const { enabled } = hook.state;
  const borderCls = enabled ? 'border-(--color-ink)' : 'border-(--color-rule)';
  return (
    <div className={`flex items-baseline justify-between gap-4 border ${borderCls} rounded-sm p-4 bg-(--color-surface)/40`}>
      <ToggleCopy enabled={enabled} />
      <ToggleBtn enabled={enabled} onToggle={hook.toggleEnabled} />
    </div>
  );
}

function ToggleCopy({ enabled }: { enabled: boolean }) {
  const t = useTranslations('adminPages.byoai');
  return (
    <div className="min-w-0">
      <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-1.5 flex items-baseline gap-2">
        <span>{t('modeLabel')}</span>
        <ToggleFlag enabled={enabled} />
      </div>
      <p className="reading-tight text-(--color-muted) text-[14.5px] max-w-[46em]">
        {t('modeHelp')}
      </p>
    </div>
  );
}

function ToggleFlag({ enabled }: { enabled: boolean }) {
  const t = useTranslations('adminPages.byoai');
  const cls = enabled ? 'text-(--color-accent)' : 'text-(--color-faint)';
  return <span className={cls}>{enabled ? t('flagOn') : t('flagOff')}</span>;
}

function ToggleBtn({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  const t = useTranslations('adminPages.byoai');
  const cls = enabled
    ? 'bg-(--color-ink) text-(--color-paper) hover:bg-(--color-accent)'
    : 'border border-(--color-ink) text-(--color-ink) hover:bg-(--color-ink) hover:text-(--color-paper)';
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`mono text-[11px] tracking-[0.16em] uppercase px-3.5 py-2 transition-colors shrink-0 ${cls}`}
    >
      {enabled ? t('turnOff') : t('turnOn')}
    </button>
  );
}

function ProviderPicker({ hook }: { hook: BYOAIHook }) {
  return hook.state.enabled
    ? <ProviderChips providers={hook.state.providers} toggle={hook.toggleProvider} />
    : null;
}

function ProviderChips({
  providers, toggle,
}: { providers: readonly BYOAIProvider[]; toggle: (p: BYOAIProvider) => void }) {
  const t = useTranslations('adminPages.byoai');
  return (
    <div>
      <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-2">
        {t('acceptedProviders')}
      </div>
      <div className="flex flex-wrap gap-2">
        {ALL_PROVIDERS.map((p) => (
          <Chip
            key={p.id}
            active={providers.includes(p.id)}
            onClick={() => toggle(p.id)}
          >
            <ChipText on={providers.includes(p.id)} label={p.label} />
          </Chip>
        ))}
      </div>
    </div>
  );
}

function ChipText({ on, label }: { on: boolean; label: string }) {
  return <>{on ? '✓ ' : ''}{label}</>;
}

function BlurbField({ hook }: { hook: BYOAIHook }) {
  const t = useTranslations('adminPages.byoai');
  return hook.state.enabled
    ? <EditField
        label={t('blurbLabel')}
        monoHint={t('blurbHint')}
        value={hook.state.blurb}
        onChange={hook.setBlurb}
        multiline={3}
      />
    : null;
}
