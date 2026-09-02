// AIProviderPanel — the "owner's AI" block on /admin/api-mcp.
//
// owner picks a provider (anthropic / openai / deepseek / kimi / groq /
// siliconflow / openrouter / together / custom) + fills endpoint + model +
// pastes a key. Plaintext key never comes back in the response; only an
// "● key set" status. Resetting the key just fills the new value, replacing
// the old one. "clear" wipes the key (provider / endpoint / model kept).
//
// preset list comes from GET /api/admin/ai-provider/presets; picking one
// auto-fills the default endpoint. model is always typed by hand (or click
// "Load models" to pull the real available list). If owner hasn't edited the
// endpoint (value == the previous preset's default), switching provider
// refills the new default; if they edited it, their value is kept
// (switchProvider lives in lib/inference/provider-form.ts).

'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { AdminSectionHead } from '@/components/admin/AdminSectionHead';
import { ModelLoaderRow } from '@/components/inference/ModelLoaderRow';
import { InlineSkeleton } from '@/components/skeletons/InlineSkeleton';
import { type AIProviderPresetView } from '@/lib/api/admin';
import {
  useAIProvider, applySaveSuccess,
  type AIProviderHook, type AIProviderName,
} from '@/lib/admin/use-ai-provider';
import {
  seededProviderForm, setEndpoint, setModel, switchProvider,
  EMPTY_DEFAULTS, type ProviderFormState,
} from '@/lib/inference/provider-form';
import { useModelList, type ModelListHook } from '@/lib/inference/use-model-list';
import { usePresets } from '@/lib/inference/use-presets';
import { useEffectErrorToast, useToast } from '@/lib/ui/toast';

export function AIProviderPanel() {
  const hook = useAIProvider();
  const t = useTranslations('adminIntegrations.aiProvider');
  useEffectErrorToast(hook.state.error);
  return (
    <div data-testid="ai-provider-panel">
      <AdminSectionHead className="mb-3">{t('heading')}</AdminSectionHead>
      <Intro />
      <PanelBody hook={hook} />
    </div>
  );
}

function Intro() {
  const t = useTranslations('adminIntegrations.aiProvider');
  return (
    <p className="reading-tight text-(--color-muted) text-[14.5px] max-w-[54em] mb-4">
      {t('intro')}
    </p>
  );
}

function PanelBody({ hook }: { hook: AIProviderHook }) {
  const presets = usePresets();
  const ready = !hook.state.loading && presets !== null;
  return ready
    ? <PanelForm hook={hook} presets={presets} />
    : <Loading />;
}

function Loading() {
  return <InlineSkeleton width="w-48" />;
}

// defaultsForName — look up the default endpoint for a given name in the
// fetched preset list. model has no default anymore (preset table dropped
// default_model); owner types it by hand or clicks "Load models".
function defaultsForName(
  name: string, presets: readonly AIProviderPresetView[],
) {
  const p = presets.find((x) => x.name === name);
  return p ? { endpoint: p.base_url } : EMPTY_DEFAULTS;
}

function PanelForm({
  hook, presets,
}: { hook: AIProviderHook; presets: readonly AIProviderPresetView[] }) {
  // #33: seed from the SoT (hook.state.endpoint/model, what /me reports as
  // owner's saved values) rather than the preset default — reopening
  // settings should show owner's last-saved endpoint + MODEL.
  const [form, setForm] = useState<ProviderFormState>(
    () => seededProviderForm(
      hook.state.provider, hook.state.endpoint, hook.state.model,
      defaultsForName(hook.state.provider, presets).endpoint,
    ),
  );
  const [keyText, setKeyText] = useState('');
  // Failure stays **right under this button**, not in a corner toast: the
  // hand is on this button, and so is the eye (UX-82 caught the same issue
  // for gate; admin hadn't caught up yet — the second half of F-R-11).
  const [modelsError, setModelsError] = useState('');
  const models = useModelList(setModelsError);
  return (
    <PanelFormBody
      hook={hook} presets={presets}
      form={form} setForm={setForm}
      keyText={keyText} setKeyText={setKeyText}
      models={models} modelsError={modelsError}
    />
  );
}

function PanelFormBody({
  hook, presets, form, setForm, keyText, setKeyText, models, modelsError,
}: {
  hook: AIProviderHook;
  presets: readonly AIProviderPresetView[];
  form: ProviderFormState;
  setForm: React.Dispatch<React.SetStateAction<ProviderFormState>>;
  keyText: string;
  setKeyText: (v: string) => void;
  models: ModelListHook;
  modelsError: string;
}) {
  return (
    <div className="space-y-4">
      <ProviderRow
        provider={form.provider} presets={presets}
        onChange={(name) => {
          setForm((p) => switchProvider(p, name, defaultsForName(name, presets)));
          models.reset();
        }}
      />
      <EndpointRow
        value={form.endpoint}
        onChange={(v) => setForm((p) => setEndpoint(p, v))}
      />
      <ModelRow
        value={form.model}
        onChange={(v) => setForm((p) => setModel(p, v))}
        models={models}
        // If a key is already saved, take the owner path (server looks up
        // its stored key); if not saved yet, send what was just typed —
        // on first-time setup the server genuinely doesn't have it (F-R-11).
        onLoad={() => void (keyText === '' && hook.state.keyConfigured
          ? models.loadOwn()
          : models.load({
            provider: form.provider, endpoint: form.endpoint, key: keyText,
          }))}
      />
      <ModelsError message={modelsError} />
      <KeyRow keyText={keyText} setKey={setKeyText} configured={hook.state.keyConfigured} />
      <ButtonsRow
        hook={hook} form={form} keyText={keyText} resetKey={() => setKeyText('')}
      />
    </div>
  );
}

function ProviderRow({
  provider, presets, onChange,
}: {
  provider: AIProviderName;
  presets: readonly AIProviderPresetView[];
  onChange: (name: string) => void;
}) {
  const t = useTranslations('adminIntegrations.aiProvider');
  return (
    <div>
      <Label>{t('provider')}</Label>
      <div className="flex gap-2 flex-wrap">
        {presets.map((p) => (
          <ProviderBtn
            key={p.name} preset={p}
            active={p.name === provider} onPick={onChange}
          />
        ))}
      </div>
    </div>
  );
}

function ProviderBtn({
  preset, active, onPick,
}: {
  preset: AIProviderPresetView;
  active: boolean;
  onPick: (name: string) => void;
}) {
  const cls = active
    ? 'bg-(--color-ink) text-(--color-paper)'
    : 'bg-transparent border border-(--color-rule) text-(--color-muted)';
  return (
    <button
      type="button"
      onClick={() => onPick(preset.name)}
      data-testid={`ai-provider-${preset.name}`}
      title={preset.label}
      className={`mono text-[10px] tracking-[0.16em] uppercase px-3 py-1.5 hover:border-(--color-ink) ${cls}`}
    >
      {preset.name}
    </button>
  );
}

function EndpointRow({
  value, onChange,
}: { value: string; onChange: (v: string) => void }) {
  const t = useTranslations('adminIntegrations.aiProvider');
  return (
    <div>
      <Label>{t('endpoint')}</Label>
      <input
        type="url"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="https://api.example.com"
        spellCheck={false}
        autoComplete="off"
        data-testid="ai-provider-endpoint"
        className="sm-field-input sm-mono"
      />
    </div>
  );
}

const ADMIN_MODEL_INPUT_CLASS =
  'flex-1 bg-transparent border-b border-(--color-rule) focus:border-(--color-ink) ' +
  'py-2 mono text-[13px]';

function ModelRow({
  value, onChange, models, onLoad,
}: {
  value: string; onChange: (v: string) => void;
  models: ModelListHook; onLoad: () => void;
}) {
  const t = useTranslations('adminIntegrations.aiProvider');
  return (
    <div>
      <Label>{t('model')}</Label>
      <ModelLoaderRow
        value={value} onChange={onChange}
        models={models} onLoad={onLoad}
        testidPrefix="ai-provider"
        className="flex items-baseline gap-3 w-full"
        inputClassName={ADMIN_MODEL_INPUT_CLASS}
      />
    </div>
  );
}

function KeyRow({
  keyText, setKey, configured,
}: { keyText: string; setKey: (v: string) => void; configured: boolean }) {
  const t = useTranslations('adminIntegrations.aiProvider');
  return (
    <div>
      <Label>{t('apiKey')}</Label>
      <input
        type="password"
        value={keyText}
        onChange={(e) => setKey(e.target.value)}
        placeholder={configured ? '● already set · type to replace' : 'paste key here'}
        spellCheck={false}
        autoComplete="off"
        data-testid="ai-provider-key"
        className="sm-field-input sm-mono"
      />
      <KeyHint configured={configured} typing={keyText !== ''} />
    </div>
  );
}

// ModelsError — the message shown when the list can't be fetched, right
// under the button (the rule UX-82 set for gate).
function ModelsError({ message }: { message: string }) {
  return message === '' ? null : (
    <p
      className="mono text-[11px] text-(--color-accent) -mt-2"
      data-testid="ai-provider-models-error"
    >
      {message}
    </p>
  );
}

function KeyHint({ configured, typing }: { configured: boolean; typing: boolean }) {
  return (
    <div className="mono text-[10.5px] tracking-[0.04em] text-(--color-faint) mt-1">
      {typing ? 'will replace existing key on save'
        : configured ? '● key set · leave blank to keep'
        : '○ not set'}
    </div>
  );
}

function ButtonsRow({
  hook, form, keyText, resetKey,
}: {
  hook: AIProviderHook;
  form: ProviderFormState;
  keyText: string;
  resetKey: () => void;
}) {
  const toast = useToast();
  return (
    <div className="flex items-baseline gap-3 pt-2">
      <SaveBtn hook={hook} form={form} keyText={keyText} toast={toast} resetKey={resetKey} />
      <ClearBtn hook={hook} toast={toast} resetKey={resetKey} />
    </div>
  );
}

function SaveBtn({
  hook, form, keyText, toast, resetKey,
}: {
  hook: AIProviderHook;
  form: ProviderFormState;
  keyText: string;
  toast: ReturnType<typeof useToast>;
  resetKey: () => void;
}) {
  const disabled = hook.state.saving || !canSubmit(form);
  const onSave = () => void runSave(hook, form, keyText, toast, resetKey);
  return (
    <button
      type="button"
      onClick={onSave}
      disabled={disabled}
      data-testid="ai-provider-save"
      // This hand-copied mono/uppercase/bg-ink/hover-accent string is exactly
      // `.sm-btn.sm-btn-solid`. Copying it in each place is why the same page
      // ended up with three button looks — use the atom, stop copying.
      className="sm-btn sm-btn-solid sm-btn-sm"
    >
      {hook.state.saving ? 'saving…' : 'save'}
    </button>
  );
}

function canSubmit(form: ProviderFormState): boolean {
  return form.endpoint.trim() !== '' && form.model.trim() !== '';
}

async function runSave(
  hook: AIProviderHook, form: ProviderFormState, keyText: string,
  toast: ReturnType<typeof useToast>, resetKey: () => void,
): Promise<void> {
  const ok = await hook.save({
    provider: form.provider,
    endpoint: form.endpoint.trim(),
    model: form.model.trim(),
    key: keyText,
  });
  applySaveSuccess(ok, resetKey, () => toast.success('AI provider saved'));
}

function ClearBtn({
  hook, toast, resetKey,
}: {
  hook: AIProviderHook;
  toast: ReturnType<typeof useToast>;
  resetKey: () => void;
}) {
  const t = useTranslations('adminIntegrations.aiProvider');
  const onClear = () => void runClear(hook, toast, resetKey);
  return hook.state.keyConfigured ? (
    <button
      type="button"
      onClick={onClear}
      data-testid="ai-provider-clear"
      className="sm-btn sm-btn-danger sm-btn-sm"
    >
      {t('clearKey')}
    </button>
  ) : null;
}

async function runClear(
  hook: AIProviderHook,
  toast: ReturnType<typeof useToast>, resetKey: () => void,
): Promise<void> {
  const ok = await hook.clearKey();
  applySaveSuccess(ok, resetKey, () => toast.success('AI provider cleared'));
}

function Label({ children }: { children: string }) {
  return (
    <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-2">
      {children}
    </div>
  );
}
