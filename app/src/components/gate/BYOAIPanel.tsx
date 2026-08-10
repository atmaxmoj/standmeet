// BYOAIPanel —— gate "no code? BYOAI"：左侧解释 + 右侧 provider/key 表单。
//
// 4 个字段 (provider / endpoint / model / key) 全提交：endpoint 选 preset
// 时自动预填（custom 必须自填），model 永远手输或点 "Load models" 拉真实
// 列表。e2e selector：byoai-provider / byoai-endpoint / byoai-model /
// byoai-key / byoai-load-models / byoai-model-select / byoai-submit。
//
// 切 provider 时的"用户改过没"判断在 lib/inference/provider-form.ts 里；
// load-models 状态机在 lib/inference/use-model-list.ts 里；model 行的三态
// 渲染在 components/inference/ModelLoaderRow.tsx 里。

'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { SelectField } from '@/components/atoms/SelectField';
import { ModelLoaderRow } from '@/components/inference/ModelLoaderRow';
import { lookupPreset, PRESETS, type InferencePreset } from '@/lib/inference/presets';
import {
  initialProviderForm, setEndpoint, setModel, switchProvider,
  EMPTY_DEFAULTS, type ProviderFormState,
} from '@/lib/inference/provider-form';
import { useModelList, type ModelListHook } from '@/lib/inference/use-model-list';
import { postGateHref } from '@/lib/gate/code-panel-logic';
import type { GateHook } from '@/lib/gate/use-gate';
import { useToast } from '@/lib/ui/toast';

type Props = {
  hook: GateHook;
};

const INITIAL_PROVIDER = 'anthropic';

function defaultsFor(provider: string) {
  const p = lookupPreset(provider);
  return p ? { endpoint: p.baseUrl } : EMPTY_DEFAULTS;
}

function initialForm(): ProviderFormState {
  return initialProviderForm(INITIAL_PROVIDER, defaultsFor(INITIAL_PROVIDER));
}

export function BYOAIPanel({ hook }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [form, setForm] = useState<ProviderFormState>(initialForm);
  const [apiKey, setApiKey] = useState('');
  const [reveal, setReveal] = useState(false);
  const onToastError = useCallback((m: string) => toast.error(m), [toast]);
  const models = useModelList(onToastError);

  const onProvider = useCallback((name: string) => {
    setForm((prev) => switchProvider(prev, name, defaultsFor(name)));
    models.reset();
  }, [models]);
  const onEndpoint = useCallback((v: string) => setForm((p) => setEndpoint(p, v)), []);
  const onModel = useCallback((v: string) => setForm((p) => setModel(p, v)), []);

  const onSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    await trySubmit({ form, apiKey, hook, router });
  }, [apiKey, form, hook, router]);

  return (
    <section id="byoai" data-testid="byoai-panel">
      <div className="grid grid-cols-1 md:grid-cols-[1fr_2fr] gap-10">
        <BYOAIHeadline />
        <BYOAIForm
          form={form} onProvider={onProvider}
          onEndpoint={onEndpoint} onModel={onModel}
          apiKey={apiKey} setApiKey={setApiKey}
          reveal={reveal} setReveal={setReveal}
          onSubmit={onSubmit} busy={hook.state.busy}
          models={models}
        />
      </div>
    </section>
  );
}

function BYOAIHeadline() {
  const t = useTranslations('gate');
  return (
    <div>
      <div className="mono text-[10px] tracking-[0.2em] uppercase text-(--color-muted) mb-3 flex items-baseline gap-2">
        <span>{t('common.noCode')}</span>
        <span className="text-(--color-faint)">·</span>
        <span className="text-(--color-accent)">BYOAI</span>
      </div>
      <h2 className="font-serif text-(--color-ink) text-[28px] font-normal tracking-[-0.015em] leading-[1.1]">
        {t('byoai.headline')}<span className="text-(--color-accent)">.</span>
      </h2>
      <p className="reading text-(--color-muted) mt-3 text-[15.5px]">
        {t('byoai.lede')}
      </p>
      <ul className="mt-5 mono text-[10.5px] tracking-[0.06em] leading-[1.85] text-(--color-muted)">
        <li><span className="text-(--color-faint)">·</span> {t('byoai.bulletKey')}</li>
        <li><span className="text-(--color-faint)">·</span> {t('byoai.bulletPays')}</li>
        <li><span className="text-(--color-faint)">·</span> {t('byoai.bulletPrivate')}</li>
      </ul>
    </div>
  );
}

type FormProps = {
  form: ProviderFormState;
  onProvider: (p: string) => void;
  onEndpoint: (v: string) => void;
  onModel: (v: string) => void;
  apiKey: string;
  setApiKey: (v: string) => void;
  reveal: boolean;
  setReveal: (v: boolean) => void;
  onSubmit: (e: React.FormEvent) => Promise<void>;
  busy: boolean;
  models: ModelListHook;
};

function BYOAIForm(p: FormProps) {
  const ph = placeholdersFor(p.form.provider);
  return (
    // autoComplete off on the form + new-password on the key (below) stop the browser's
    // login-form heuristic autofilling a saved email→model / password→key (UX-8).
    <form onSubmit={p.onSubmit} className="rise" autoComplete="off">
      <ProviderRow value={p.form.provider} onChange={p.onProvider} />
      <EndpointRow value={p.form.endpoint} onChange={p.onEndpoint} placeholder={ph.endpoint} />
      <ModelRow
        value={p.form.model} onChange={p.onModel}
        models={p.models}
        loadDisabled={p.apiKey.trim() === ''}
        onLoad={() => void p.models.load({
          provider: p.form.provider, endpoint: p.form.endpoint, key: p.apiKey,
        })}
      />
      <KeyRow
        value={p.apiKey} onChange={p.setApiKey}
        reveal={p.reveal} onToggleReveal={() => p.setReveal(!p.reveal)}
        placeholder={ph.key}
      />
      <ReadyRow
        apiKey={p.apiKey} endpoint={p.form.endpoint} model={p.form.model}
        busy={p.busy}
      />
    </form>
  );
}

interface Placeholders {
  endpoint: string;
  key: string;
}

const EMPTY_PRESET: InferencePreset = {
  name: '', label: '', baseUrl: '', keyPrefix: '',
};

function placeholdersFor(provider: string): Placeholders {
  const preset = lookupPreset(provider) ?? EMPTY_PRESET;
  return {
    endpoint: epPlaceholder(preset.baseUrl),
    key: keyPlaceholder(preset.keyPrefix),
  };
}

function epPlaceholder(baseUrl: string): string {
  return baseUrl === '' ? 'https://your-endpoint.example.com' : baseUrl;
}

function keyPlaceholder(keyPrefix: string): string {
  return keyPrefix === '' ? 'paste your key' : `${keyPrefix}…`;
}

function ProviderRow({ value, onChange }: { value: string; onChange: (p: string) => void }) {
  const t = useTranslations('gate.byoai');
  return (
    <>
      <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-2">
        {t('chooseModel')}
      </div>
      {/* 这里原本是 `provider-pick is-on` —— 近黑实心,是整个 gate 页最重的色块(UX-36)。
          一个"选哪家"的下拉不该比"进来"那个动作更抢眼。换成全 app 同一个下拉。 */}
      <SelectField
        value={value}
        onChange={(e) => onChange(e.target.value)}
        testid="byoai-provider"
        className="mb-5"
        mono
      >
        {PRESETS.map((p) => (
          <option key={p.name} value={p.name}>{p.label}</option>
        ))}
      </SelectField>
    </>
  );
}

function EndpointRow({
  value, onChange, placeholder,
}: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const t = useTranslations('gate.byoai');
  return (
    <>
      <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-2">
        {t('endpoint')}
      </div>
      <div className="flex items-baseline gap-3 border-b border-(--color-rule) pb-1 mb-5">
        <input
          type="url"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          data-testid="byoai-endpoint"
          autoComplete="off"
          spellCheck={false}
          className="flex-1 bg-transparent mono py-2 reading text-(--color-ink) placeholder:text-(--color-faint) text-[14.5px] tracking-[0.02em]"
        />
      </div>
    </>
  );
}

const MODEL_INPUT_CLASS =
  'flex-1 bg-transparent mono py-2 reading text-(--color-ink) ' +
  'placeholder:text-(--color-faint) text-[14.5px] tracking-[0.02em]';

function ModelRow({
  value, onChange, models, onLoad, loadDisabled,
}: {
  value: string; onChange: (v: string) => void;
  models: ModelListHook; onLoad: () => void; loadDisabled: boolean;
}) {
  const t = useTranslations('gate.byoai');
  return (
    <>
      <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-2">
        {t('model')}
      </div>
      <ModelLoaderRow
        value={value} onChange={onChange}
        models={models} onLoad={onLoad}
        testidPrefix="byoai"
        loadDisabled={loadDisabled}
        className="flex items-baseline gap-3 border-b border-(--color-rule) pb-1 mb-5"
        inputClassName={MODEL_INPUT_CLASS}
      />
    </>
  );
}

function KeyRow({
  value, onChange, reveal, onToggleReveal, placeholder,
}: {
  value: string; onChange: (v: string) => void;
  reveal: boolean; onToggleReveal: () => void;
  placeholder: string;
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
    </>
  );
}

function ReadyRow({
  apiKey, endpoint, model, busy,
}: { apiKey: string; endpoint: string; model: string; busy: boolean }) {
  const trimmedKey = apiKey.trim();
  const valid = isValid(trimmedKey, endpoint, model);
  return (
    <div className="mt-4 mono text-[10px] tracking-[0.06em] text-(--color-muted) flex items-baseline justify-between gap-3 flex-wrap">
      <ReadyHint valid={valid} apiKey={trimmedKey} />
      <SubmitButton disabled={!valid || busy} busy={busy} />
    </div>
  );
}

function isValid(key: string, endpoint: string, model: string): boolean {
  return key.length > 12 && endpoint.trim() !== '' && model.trim() !== '';
}

function ReadyHint({ valid, apiKey }: { valid: boolean; apiKey: string }) {
  const t = useTranslations('gate.byoai');
  return valid
    ? <span>{t('readyUsing')} <MaskedKey value={apiKey} /></span>
    : <span className="text-(--color-faint)">{t('fillHint')}</span>;
}

function MaskedKey({ value }: { value: string }) {
  const tail = value.slice(-4);
  return (
    <span className="mono text-[11px] tracking-[0.04em] text-(--color-muted)">
      {Array.from({ length: 12 }).map((_, i) => <span key={i} className="keydot" />)}
      <span className="ml-1 text-(--color-ink)">{tail}</span>
    </span>
  );
}

function SubmitButton({ disabled, busy }: { disabled: boolean; busy: boolean }) {
  const t = useTranslations('gate.byoai');
  return (
    <button
      type="submit"
      disabled={disabled}
      data-testid="byoai-submit"
      className="mono text-[11px] tracking-[0.16em] uppercase text-(--color-paper) bg-(--color-ink) px-4 py-2.5 hover:bg-(--color-accent) transition-colors disabled:opacity-40 shrink-0"
    >
      {busy ? t('warmingUp') : t('submit')}
    </button>
  );
}

// trySubmit —— "form 已经填齐才发"的 wrapper；放在文件级让 onSubmit 这个
// useCallback 复杂度保持 1。invalid 直接 noop，UI 上 submit button 已经
// disabled，这里是双保险。
async function trySubmit(args: {
  form: ProviderFormState;
  apiKey: string;
  hook: GateHook;
  router: ReturnType<typeof useRouter>;
}): Promise<void> {
  const key = args.apiKey.trim();
  const endpoint = args.form.endpoint.trim();
  const model = args.form.model.trim();
  const ready = isValid(key, endpoint, model);
  ready && (await runBYOAISubmit(
    { provider: args.form.provider, endpoint, model, key },
    args.hook, args.router,
  ));
}

async function runBYOAISubmit(
  input: { provider: string; endpoint: string; model: string; key: string },
  hook: GateHook,
  router: ReturnType<typeof useRouter>,
): Promise<void> {
  const ok = await hook.submitBYOAI(input);
  // 落根 / —— byoai 状态在 localStorage（use-gate.persistSession），
  // page-shell mount 时读 store，URL 不挂 flag。带回首页问题 ?q=(跟 code 一致)。
  ok && router.push(postGateHref());
}
