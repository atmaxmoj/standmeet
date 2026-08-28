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

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { SelectField } from '@/components/atoms/SelectField';
import { KeyRow } from '@/components/gate/BYOAIKeyRow';
import { ModelLoaderRow } from '@/components/inference/ModelLoaderRow';
import { lookupPreset, PRESETS, type InferencePreset } from '@/lib/inference/presets';
import {
  initialProviderForm, setEndpoint, setModel, switchProvider,
  EMPTY_DEFAULTS, type ProviderFormState,
} from '@/lib/inference/provider-form';
import { useModelList, type ModelListHook } from '@/lib/inference/use-model-list';
import { postGateHref } from '@/lib/gate/code-panel-logic';
import { keyStorageAvailable } from '@/lib/gate/key-storage';
import type { GateHook } from '@/lib/gate/use-gate';

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
  const [form, setForm] = useState<ProviderFormState>(initialForm);
  const [apiKey, setApiKey] = useState('');
  const [reveal, setReveal] = useState(false);
  // modelError —— `LOAD MODELS` 失败时说的那句话，**留在这一页里**（UX-82）。
  //
  // 以前它走 `toast.error`：按的是 BYOAI 面板里的按钮，而
  // `✗ ERR provider does not expose a model list; type model id manually`
  // 出现在**视口右下角** —— 视线在按钮上，那儿没人看。而这个产品别处都把拒绝**贴在出错的
  // 控件下面**（`/gate` 的码错误、connectors 弹窗里那句 SSRF 拒绝就在 URL 框正下方，
  // 同一文件里 F-G-6 那段注释讲的也是这件事）。这里换了一种规矩，还换成最容易被错过的那种。
  const [modelError, setModelError] = useState<string | null>(null);
  const onModelError = useCallback((m: string) => setModelError(m), []);
  const models = useModelList(onModelError);
  // 挂载后再问浏览器「这里存得住 key 吗」（F-D-14）。SSR 那一帧按正常部署走，
  // 否则每个 https 访客都要先闪一下不该看见的警告。
  const [canStore, setCanStore] = useState(true);
  useEffect(() => setCanStore(keyStorageAvailable()), []);

  const onProvider = useCallback((name: string) => {
    setForm((prev) => switchProvider(prev, name, defaultsFor(name)));
    models.reset();
    // 换了 provider，上一家的那句拒绝就不再成立 —— 留着它会让人以为新选的这家也不行。
    setModelError(null);
  }, [models]);
  const onEndpoint = useCallback((v: string) => setForm((p) => setEndpoint(p, v)), []);
  const onModel = useCallback((v: string) => setForm((p) => setModel(p, v)), []);

  const onSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    await trySubmit({ form, apiKey, hook, router });
  }, [apiKey, form, hook, router]);

  return (
    <section id="byoai" data-testid="byoai-panel">
      {/* 两列还是一列，看**这一格有多宽**（`@md`），不是看视口有多宽（`md:`）。
          原来是 `md:grid-cols-[1fr_2fr]`：视口一过 768 就必两列 —— 而这个面板现在也长在
          阅读器右栏那条 380px 的轨道里，1920 的屏上它照样判成"宽"，于是塌成两列窄栏，
          每行一两个词，端点和 key 的输入框直接溢出到屏幕外。
          组件被搬到别处时，跟着它走的是标记，不是它当初那个版面的宽度。 */}
      <div className="@container">
        <div className="grid grid-cols-1 @md:grid-cols-[1fr_2fr] gap-10">
          <BYOAIHeadline />
          <BYOAIForm
            form={form} onProvider={onProvider}
            onEndpoint={onEndpoint} onModel={onModel}
            apiKey={apiKey} setApiKey={setApiKey}
            reveal={reveal} setReveal={setReveal}
            onSubmit={onSubmit} busy={hook.byoai.busy} error={hook.byoai.error}
            models={models} modelError={modelError} canStore={canStore}
          />
        </div>
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
  error: string | null;
  models: ModelListHook;
  // modelError —— `LOAD MODELS` 的拒绝，贴在那个按钮下面而不是视口角落（UX-82）。
  modelError: string | null;
  // canStore —— 这个浏览器存不存得住 key（F-D-14）。存不住时整条 BYOAI 路都走不通。
  canStore: boolean;
};

function BYOAIForm(p: FormProps) {
  const ph = placeholdersFor(p.form.provider);
  return (
    // autoComplete off on the form + new-password on the key (below) stop the browser's
    // login-form heuristic autofilling a saved email→model / password→key (UX-8).
    <form onSubmit={p.onSubmit} className="rise" autoComplete="off">
      {/* 这四格**必须一柱到底**。试过排成 2×2 想压低这一段的纵向占地（UX-37：没有码的人
          才走的备用路，却是整页占地最大的一块）—— 在 1280 视口下这一栏只有约 350px，
          对半劈开后端点被截断、`LOAD MODELS` 压在 API KEY 上。要真的降它的重心，得折叠
          或重排整页，那两条都会改交互和测试，不属于设计列。 */}
      <ProviderRow value={p.form.provider} onChange={p.onProvider} />
      <EndpointRow value={p.form.endpoint} onChange={p.onEndpoint} placeholder={ph.endpoint} />
      <ModelRow
        value={p.form.model} onChange={p.onModel}
        models={p.models}
        loadDisabled={p.apiKey.trim() === ''}
        modelError={p.modelError}
        onLoad={() => void p.models.load({
          provider: p.form.provider, endpoint: p.form.endpoint, key: p.apiKey,
        })}
      />
      <KeyRow
        value={p.apiKey} onChange={p.setApiKey}
        reveal={p.reveal} onToggleReveal={() => p.setReveal(!p.reveal)}
        placeholder={ph.key}
        keyPrefix={ph.keyPrefix}
      />
      {/* 这一句以前落在整页最底下那个共用的错误行里 —— 离出错的表单一千多像素，而访客的
          眼睛在按钮上。现在它贴着自己的提交键（F-G-6）。 */}
      <BYOAIError message={p.error} />
      <InsecureOriginNote canStore={p.canStore} />
      <ReadyRow
        apiKey={p.apiKey} endpoint={p.form.endpoint} model={p.form.model}
        busy={p.busy} canStore={p.canStore}
      />
    </form>
  );
}

// InsecureOriginNote —— 这一页是用 http 从别的机器打开的，于是这个浏览器**没有** `crypto.subtle`，
// 那把 key 无处可存（F-D-14）。它出现在按钮**上方**、按钮同时禁用：这条路走不通的时候，
// 不该让人一路填完再撞一句「再试一次」——那句话在这里是谎话，重试永远不会成功。
// 说的是出路（找 owner 要 https 地址），不是状态。
function InsecureOriginNote({ canStore }: { canStore: boolean }) {
  const t = useTranslations('gate.byoai');
  return canStore ? null : (
    <p
      className="mono text-[10.5px] tracking-[0.06em] leading-[1.7] text-(--color-accent) mt-4"
      data-testid="byoai-insecure-origin"
    >
      {t('insecureOrigin')}
    </p>
  );
}

function BYOAIError({ message }: { message: string | null }) {
  return message === null ? null : (
    <p
      className="mono text-[10.5px] tracking-[0.16em] uppercase text-(--color-accent) mt-4"
      data-testid="byoai-error"
    >
      {message}
    </p>
  );
}

interface Placeholders {
  endpoint: string;
  key: string;
  // keyPrefix —— 原样透出来给形状提示用（占位符里那个 `…` 版本读起来是例子，不是判据）。
  keyPrefix: string;
}

const EMPTY_PRESET: InferencePreset = {
  name: '', label: '', baseUrl: '', keyPrefix: '',
};

function placeholdersFor(provider: string): Placeholders {
  const preset = lookupPreset(provider) ?? EMPTY_PRESET;
  return {
    endpoint: epPlaceholder(preset.baseUrl),
    key: keyPlaceholder(preset.keyPrefix),
    keyPrefix: preset.keyPrefix,
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
  value, onChange, models, onLoad, loadDisabled, modelError,
}: {
  value: string; onChange: (v: string) => void;
  models: ModelListHook; onLoad: () => void; loadDisabled: boolean;
  modelError: string | null;
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
        // flex-wrap：`LOAD MODELS` 跟输入框并排，而这个面板现在也长在 380px 的阅读器
        // 右栏里 —— 不换行的话按钮被切在容器外，读者根本点不到它。
        className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-(--color-rule) pb-1"
        inputClassName={MODEL_INPUT_CLASS}
      />
      <ModelError message={modelError} />
    </>
  );
}

// ModelError —— `LOAD MODELS` 的拒绝，**贴着那个按钮**（UX-82）。
// 没有错误时这一格仍占住底部间距，免得出现错误时下面整段跳一下。
function ModelError({ message }: { message: string | null }) {
  return message === null ? <div className="mb-5" /> : (
    <p
      className="mono text-[10.5px] tracking-[0.06em] leading-[1.7] text-(--color-accent) mt-2 mb-5"
      data-testid="byoai-model-error"
    >
      {message}
    </p>
  );
}

function ReadyRow({
  apiKey, endpoint, model, busy, canStore,
}: {
  apiKey: string; endpoint: string; model: string; busy: boolean; canStore: boolean;
}) {
  const trimmedKey = apiKey.trim();
  // 存不住 key 的时候「填齐了」也不算 ready —— 那句 `ready · using ●●●●99c2` 曾经在
  // 密文一个字节都没落盘的情况下照常显示（F-D-14 同一屏的第二句谎）。
  const valid = isValid(trimmedKey, endpoint, model) && canStore;
  return (
    <div className="mt-4 mono text-[10px] tracking-[0.06em] text-(--color-muted) flex items-baseline justify-between gap-3 flex-wrap">
      <ReadyHint valid={valid} apiKey={trimmedKey} canStore={canStore} />
      <SubmitButton disabled={!valid || busy} busy={busy} />
    </div>
  );
}

function isValid(key: string, endpoint: string, model: string): boolean {
  return key.length > 12 && endpoint.trim() !== '' && model.trim() !== '';
}

// ReadyHint —— 存不住 key 时整条让位给上面那句朱红说明（F-D-14）。留着它会变成第三句错话：
// 三个字段明明填满了，它却在喊「fill endpoint, model + key」—— 指使人去做一件已经做完、
// 而且做完也没用的事。
function ReadyHint(
  { valid, apiKey, canStore }: { valid: boolean; apiKey: string; canStore: boolean },
) {
  const t = useTranslations('gate.byoai');
  return !canStore
    ? <span />
    : valid
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
