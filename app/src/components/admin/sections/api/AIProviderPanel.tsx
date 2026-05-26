// AIProviderPanel —— /admin/api-mcp 上的 "owner's AI" block。
//
// owner 选 provider（anthropic / openai / deepseek / kimi / groq /
// siliconflow / openrouter / together / custom）+ 填 endpoint + model + 贴
// key。明文 key 不在 response 里回；only "● key set" 状态。重设 key 直接
// fill 新值，旧 key 被替换。点 "clear" 清 key（provider / endpoint / model
// 保留）。
//
// preset 列表从 GET /api/admin/ai-provider/presets 拉；选某项时 endpoint
// 自动填默认。model 永远手输（或点 "Load models" 拉真实可用列表）。如果
// owner 之前没改过 endpoint（值 == 上个 preset 默认），切到新 provider 时
// 重填新默认；改过则保留 owner 值（switchProvider 在 lib/inference/provider-form.ts 里实现）。

'use client';

import { useCallback, useEffect, useState } from 'react';

import { ModelLoaderRow } from '@/components/inference/ModelLoaderRow';
import { InlineSkeleton } from '@/components/skeletons/InlineSkeleton';
import {
  fetchAIProviderPresets, type AIProviderPresetView,
} from '@/lib/api/admin';
import {
  useAIProvider, applySaveSuccess,
  type AIProviderHook, type AIProviderName,
} from '@/lib/admin/use-ai-provider';
import {
  initialProviderForm, setEndpoint, setModel, switchProvider,
  EMPTY_DEFAULTS, type ProviderFormState,
} from '@/lib/inference/provider-form';
import { useModelList, type ModelListHook } from '@/lib/inference/use-model-list';
import { useEffectErrorToast, useToast } from '@/lib/ui/toast';

export function AIProviderPanel() {
  const hook = useAIProvider();
  useEffectErrorToast(hook.state.error);
  return (
    <div data-testid="ai-provider-panel">
      <h3 className="mono text-[10px] tracking-[0.2em] uppercase text-(--color-ink) mb-3 pb-2 border-b border-(--color-rule)">
        owner&apos;s ai
      </h3>
      <Intro />
      <PanelBody hook={hook} />
    </div>
  );
}

function Intro() {
  return (
    <p className="reading-tight text-(--color-muted) text-[14.5px] max-w-[54em] mb-4">
      The provider visitors talk to. Pick a preset or point at your own
      self-hosted OpenAI-compatible endpoint (ollama / vllm / lm-studio).
      Key is encrypted at rest with INSTANCE_SECRET and never read back to
      this page.
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

// usePresets —— fetch preset 列表一次。失败弹 toast；返 null 当 "still loading"。
function usePresets(): readonly AIProviderPresetView[] | null {
  const [presets, setPresets] = useState<AIProviderPresetView[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    fetchAIProviderPresets()
      .then((list) => setPresets(list))
      .catch((e: unknown) => {
        setErr(e instanceof Error ? e.message : 'failed to load presets');
      });
  }, []);
  useEffectErrorToast(err);
  return presets;
}

function Loading() {
  return <InlineSkeleton width="w-48" />;
}

// defaultsForName —— 在 fetched preset 列表里查给定 name 的默认 endpoint。
// model 不再有默认（preset 表已删 default_model）；owner 手输或点 "Load models"。
function defaultsForName(
  name: string, presets: readonly AIProviderPresetView[],
) {
  const p = presets.find((x) => x.name === name);
  return p ? { endpoint: p.base_url } : EMPTY_DEFAULTS;
}

function PanelForm({
  hook, presets,
}: { hook: AIProviderHook; presets: readonly AIProviderPresetView[] }) {
  const [form, setForm] = useState<ProviderFormState>(
    () => initialProviderForm(hook.state.provider, defaultsForName(hook.state.provider, presets)),
  );
  const [keyText, setKeyText] = useState('');
  const toast = useToast();
  const onToastError = useCallback((m: string) => toast.error(m), [toast]);
  const models = useModelList(onToastError);
  return (
    <PanelFormBody
      hook={hook} presets={presets}
      form={form} setForm={setForm}
      keyText={keyText} setKeyText={setKeyText}
      models={models}
    />
  );
}

function PanelFormBody({
  hook, presets, form, setForm, keyText, setKeyText, models,
}: {
  hook: AIProviderHook;
  presets: readonly AIProviderPresetView[];
  form: ProviderFormState;
  setForm: React.Dispatch<React.SetStateAction<ProviderFormState>>;
  keyText: string;
  setKeyText: (v: string) => void;
  models: ModelListHook;
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
        onLoad={() => void models.load({
          provider: form.provider, endpoint: form.endpoint, key: keyText,
        })}
      />
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
  return (
    <div>
      <Label>provider</Label>
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
  return (
    <div>
      <Label>endpoint</Label>
      <input
        type="url"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="https://api.example.com"
        spellCheck={false}
        autoComplete="off"
        data-testid="ai-provider-endpoint"
        className="w-full bg-transparent border-b border-(--color-rule) focus:border-(--color-ink) py-2 mono text-[13px]"
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
  return (
    <div>
      <Label>model</Label>
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
  return (
    <div>
      <Label>api key</Label>
      <input
        type="password"
        value={keyText}
        onChange={(e) => setKey(e.target.value)}
        placeholder={configured ? '● already set · type to replace' : 'paste key here'}
        spellCheck={false}
        autoComplete="off"
        data-testid="ai-provider-key"
        className="w-full bg-transparent border-b border-(--color-rule) focus:border-(--color-ink) py-2 mono text-[13px]"
      />
      <KeyHint configured={configured} typing={keyText !== ''} />
    </div>
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
      className="mono text-[10px] tracking-[0.16em] uppercase text-(--color-paper) bg-(--color-ink) px-3 py-2 hover:bg-(--color-accent) transition-colors disabled:opacity-40"
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
  const onClear = () => void runClear(hook, toast, resetKey);
  return hook.state.keyConfigured ? (
    <button
      type="button"
      onClick={onClear}
      data-testid="ai-provider-clear"
      className="mono text-[10px] tracking-[0.16em] uppercase text-(--color-faint) hover:text-(--color-accent)"
    >
      clear key ×
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
