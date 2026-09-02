// ModelLoaderRow — model field rendering shared by BYOAIPanel + AIProviderPanel.
//
// Three UI states distinguished by models.state.options:
//   - null    → text <input> + "Load models" button
//   - non-null → <select> dropdown + "↻" re-fetch + "type" switch back to input
//   - loading → button shows "loading…" / "…" disabled
//
// The testid prefix lets each panel decide for itself: byoai passes "byoai",
// admin passes "ai-provider". Corresponding testids:
//   - input:    `{prefix}-model`
//   - select:   `{prefix}-model-select`
//   - load btn: `{prefix}-load-models`

import { useTranslations } from 'next-intl';

import { SelectField } from '@/components/atoms/SelectField';
import type { ModelListHook } from '@/lib/inference/use-model-list';

const MODEL_PLACEHOLDER = 'type model id, or click Load models';

export type ModelTestidPrefix = 'byoai' | 'ai-provider';

interface RowProps {
  value: string;
  onChange: (v: string) => void;
  models: ModelListHook;
  onLoad: () => void;
  testidPrefix: ModelTestidPrefix;
  /** Outer wrapper className — BYOAI uses baseline+rule styling, admin uses
   *  border-b focus styling. Appearance is left to the caller. */
  className: string;
  inputClassName: string;
  /** loadDisabled — disables "load models" when the model list can't be fetched
   *  (#41: BYOAI can't load models without a key filled in; disable + hint.
   *  Callers that don't pass it default to false, unchanged behavior). */
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
    : <ModelSelect value={value} onChange={onChange} options={options} prefix={prefix} />;
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

// ModelSelect — doesn't take inputClassName: that class string mixes layout
// (flex-1) with appearance (underline, font size), and appearance is now owned
// by SelectField. Only the layout half remains — both callers pass flex-1.
function ModelSelect({
  value, onChange, options, prefix,
}: {
  value: string; onChange: (v: string) => void;
  options: readonly string[];
  prefix: ModelTestidPrefix;
}) {
  const t = useTranslations('visitor.modelLoader');
  return (
    <SelectField
      value={value}
      onChange={(e) => onChange(e.target.value)}
      testid={`${prefix}-model-select`}
      className="flex-1"
      mono
    >
      <option value="">{t('pickModel')}</option>
      {options.map((m) => <option key={m} value={m}>{m}</option>)}
    </SelectField>
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
      // This is an action, and it used to be `text-(--color-faint)` — the
      // lightest thing on the whole row (UX-76③). Use outline: heavier than
      // the adjacent caption text, but doesn't compete with the submit
      // action (solid) for primacy.
      className="sm-btn sm-btn-outline sm-btn-sm shrink-0"
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
