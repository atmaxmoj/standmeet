// ModelLoaderRow —— BYOAIPanel + AIProviderPanel 共用的 model 字段渲染。
//
// 三种 UI 态由 models.state.options 区分：
//   - null  → text <input> + "Load models" button
//   - 非空  → <select> dropdown + "↻" 重 fetch + "type" 切回 input
//   - loading → button 显示 "loading…" / "…" disabled
//
// testid prefix 让两边 panel 自己决定：byoai 传 "byoai"，admin 传
// "ai-provider"。对应 testid：
//   - input:    `{prefix}-model`
//   - select:   `{prefix}-model-select`
//   - load btn: `{prefix}-load-models`

import { useTranslations } from 'next-intl';

import type { ModelListHook } from '@/lib/inference/use-model-list';

const MODEL_PLACEHOLDER = 'type model id, or click Load models';

export type ModelTestidPrefix = 'byoai' | 'ai-provider';

interface RowProps {
  value: string;
  onChange: (v: string) => void;
  models: ModelListHook;
  onLoad: () => void;
  testidPrefix: ModelTestidPrefix;
  /** 外层 wrapper className —— BYOAI 是 baseline+rule 风格，admin 是
   *  border-b focus 风格。把外观留给调用方。 */
  className: string;
  inputClassName: string;
  /** loadDisabled —— 没法拉 model list 时禁用 "load models"(#41:BYOAI 没填 key
   *  就拉不了 model,禁用 + 提示;调用方不传 = false,行为不变)。 */
  loadDisabled?: boolean;
}

export function ModelLoaderRow(p: RowProps) {
  return (
    <div className={p.className}>
      <ModelField
        value={p.value} onChange={p.onChange}
        options={p.models.state.options}
        prefix={p.testidPrefix} inputClassName={p.inputClassName}
      />
      <ModelActions
        loading={p.models.state.loading} options={p.models.state.options}
        onLoad={p.onLoad} onReset={p.models.reset}
        prefix={p.testidPrefix} loadDisabled={p.loadDisabled ?? false}
      />
    </div>
  );
}

function ModelField({
  value, onChange, options, prefix, inputClassName,
}: {
  value: string; onChange: (v: string) => void;
  options: readonly string[] | null;
  prefix: ModelTestidPrefix;
  inputClassName: string;
}) {
  return options === null
    ? <ModelInput value={value} onChange={onChange} prefix={prefix} inputClassName={inputClassName} />
    : <ModelSelect value={value} onChange={onChange} options={options} prefix={prefix} inputClassName={inputClassName} />;
}

function ModelInput({
  value, onChange, prefix, inputClassName,
}: {
  value: string; onChange: (v: string) => void;
  prefix: ModelTestidPrefix; inputClassName: string;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={MODEL_PLACEHOLDER}
      data-testid={`${prefix}-model`}
      autoComplete="off"
      spellCheck={false}
      className={inputClassName}
    />
  );
}

function ModelSelect({
  value, onChange, options, prefix, inputClassName,
}: {
  value: string; onChange: (v: string) => void;
  options: readonly string[];
  prefix: ModelTestidPrefix; inputClassName: string;
}) {
  const t = useTranslations('visitor.modelLoader');
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      data-testid={`${prefix}-model-select`}
      className={`${inputClassName} cursor-pointer`}
    >
      <option value="">{t('pickModel')}</option>
      {options.map((m) => <option key={m} value={m}>{m}</option>)}
    </select>
  );
}

function ModelActions({
  loading, options, onLoad, onReset, prefix, loadDisabled,
}: {
  loading: boolean; options: readonly string[] | null;
  onLoad: () => void; onReset: () => void;
  prefix: ModelTestidPrefix; loadDisabled: boolean;
}) {
  return options === null
    ? <LoadButton loading={loading} onLoad={onLoad} prefix={prefix} loadDisabled={loadDisabled} />
    : <DropdownActions
        onLoad={onLoad} onReset={onReset} loading={loading}
        prefix={prefix} loadDisabled={loadDisabled}
      />;
}

const NO_KEY_TITLE = 'enter your API key first';

function loadTitle(loadDisabled: boolean): string | undefined {
  return loadDisabled ? NO_KEY_TITLE : undefined;
}

function refreshTitle(loadDisabled: boolean): string {
  return loadDisabled ? NO_KEY_TITLE : 'refresh model list';
}

function LoadButton({
  loading, onLoad, prefix, loadDisabled,
}: {
  loading: boolean; onLoad: () => void;
  prefix: ModelTestidPrefix; loadDisabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onLoad}
      disabled={loading || loadDisabled}
      title={loadTitle(loadDisabled)}
      data-testid={`${prefix}-load-models`}
      className="mono text-[10px] tracking-[0.12em] uppercase text-(--color-faint) hover:text-(--color-ink) disabled:opacity-40 shrink-0"
    >
      {loading ? 'loading…' : 'load models'}
    </button>
  );
}

function DropdownActions({
  onLoad, onReset, loading, prefix, loadDisabled,
}: {
  onLoad: () => void; onReset: () => void;
  loading: boolean; prefix: ModelTestidPrefix; loadDisabled: boolean;
}) {
  const t = useTranslations('visitor.modelLoader');
  return (
    <span className="flex items-baseline gap-2 shrink-0">
      <button
        type="button"
        onClick={onLoad}
        disabled={loading || loadDisabled}
        data-testid={`${prefix}-load-models`}
        title={refreshTitle(loadDisabled)}
        className="mono text-[12px] text-(--color-faint) hover:text-(--color-ink) disabled:opacity-40"
      >
        {loading ? '…' : '↻'}
      </button>
      <button
        type="button"
        onClick={onReset}
        className="mono text-[10px] tracking-[0.12em] uppercase text-(--color-faint) hover:text-(--color-ink)"
      >
        {t('type')}
      </button>
    </span>
  );
}
