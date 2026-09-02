// BYOAIPanel — gate "no code? BYOAI": left-side explanation + right-side
// provider/key form.
//
// All 4 fields (provider / endpoint / model / key) submit together: endpoint
// auto-fills when a preset is picked (custom requires manual entry), model is
// always typed by hand or fetched via "Load models". e2e selectors:
// byoai-provider / byoai-endpoint / byoai-model / byoai-key /
// byoai-load-models / byoai-model-select / byoai-submit.
//
// The "did the user edit this" check on provider switch lives in
// lib/inference/provider-form.ts; the load-models state machine lives in
// lib/inference/use-model-list.ts; the three-state model row render lives in
// components/inference/ModelLoaderRow.tsx.

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
  // modelError — the message `LOAD MODELS` fails with, **kept on this page** (UX-82).
  //
  // It used to go through `toast.error`: the click lands on a button in the BYOAI panel,
  // but `✗ ERR provider does not expose a model list; type model id manually` appears in
  // the **bottom-right corner of the viewport** — attention is on the button, nobody looks
  // there. Everywhere else in this product a rejection is **pinned under the control that
  // failed** (the `/gate` code error, the SSRF rejection in the connectors modal sits right
  // under the URL field, and the F-G-6 comment in this same file makes the same point).
  // This spot broke that convention, and picked the easiest-to-miss alternative.
  const [modelError, setModelError] = useState<string | null>(null);
  const onModelError = useCallback((m: string) => setModelError(m), []);
  const models = useModelList(onModelError);
  // Ask the browser "can this origin store a key" only after mount (F-D-14). The SSR
  // frame assumes a normal deployment, otherwise every https visitor would see a flash
  // of a warning that doesn't apply to them.
  const [canStore, setCanStore] = useState(true);
  useEffect(() => setCanStore(keyStorageAvailable()), []);

  const onProvider = useCallback((name: string) => {
    setForm((prev) => switchProvider(prev, name, defaultsFor(name)));
    models.reset();
    // On a provider switch, the previous provider's rejection no longer applies —
    // leaving it up would suggest the newly picked provider fails too.
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
      {/* One column vs. two is decided by **how wide this container is** (`@md`), not
          how wide the viewport is (`md:`). It used to be `md:grid-cols-[1fr_2fr]`:
          any viewport past 768 forced two columns — but this panel now also lives in
          the reader's 380px right rail, where a 1920px screen still counts as "wide",
          collapsing into two narrow columns of one or two words per line, with the
          endpoint and key inputs overflowing off-screen.
          When a component moves to a new home, its markup travels with it — the
          layout width it was designed against does not. */}
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
  // modelError — the `LOAD MODELS` rejection, pinned under that button instead
  // of the viewport corner (UX-82).
  modelError: string | null;
  // canStore — whether this browser can store a key (F-D-14). If it can't, the
  // whole BYOAI path is a dead end.
  canStore: boolean;
};

function BYOAIForm(p: FormProps) {
  const ph = placeholdersFor(p.form.provider);
  return (
    // autoComplete off on the form + new-password on the key (below) stop the browser's
    // login-form heuristic autofilling a saved email→model / password→key (UX-8).
    <form onSubmit={p.onSubmit} className="rise" autoComplete="off">
      {/* These four fields **must stack in a single column**. A 2x2 layout was tried
          to shrink this section's vertical footprint (UX-37: this is a fallback path
          only visitors without a code take, yet it's the tallest block on the page) —
          at a 1280 viewport this column is only ~350px wide, so splitting it in half
          truncates the endpoint and crushes `LOAD MODELS` into API KEY. Actually
          lowering its footprint needs collapsing or restructuring the page, both of
          which change interaction and tests and are out of scope for the design lane. */}
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
      {/* This message used to land in the shared error line at the very bottom of the
          page — over a thousand pixels from the form that failed, while the visitor's
          eyes are on the button. Now it's pinned next to its own submit key (F-G-6). */}
      <BYOAIError message={p.error} />
      <InsecureOriginNote canStore={p.canStore} />
      <ReadyRow
        apiKey={p.apiKey} endpoint={p.form.endpoint} model={p.form.model}
        busy={p.busy} canStore={p.canStore}
      />
    </form>
  );
}

// InsecureOriginNote — this page was opened over http from another machine, so this
// browser **has no** `crypto.subtle`, and the key has nowhere to be stored (F-D-14).
// It appears **above** the button, with the button also disabled: when a path is a
// dead end, the visitor shouldn't fill out the whole form only to hit "try again" —
// that message would be a lie here, retrying can never succeed.
// It states the way out (ask the owner for an https address), not a transient state.
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
  // keyPrefix — passed through as-is for the shape hint (the `…` version in the
  // placeholder reads as an example, not a validation rule).
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
      {/* This used to be `provider-pick is-on` — a near-black solid fill, the heaviest
          block of color on the whole gate page (UX-36). A "pick a provider" dropdown
          shouldn't outweigh the "get in" action. Switched to the app-wide dropdown. */}
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
        // flex-wrap: `LOAD MODELS` sits beside the input, and this panel now also
        // lives in the reader's 380px right rail — without wrapping, the button gets
        // clipped outside the container and readers can't click it at all.
        className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-(--color-rule) pb-1"
        inputClassName={MODEL_INPUT_CLASS}
      />
      <ModelError message={modelError} />
    </>
  );
}

// ModelError — the `LOAD MODELS` rejection, **pinned next to that button** (UX-82).
// The slot reserves its bottom margin even with no error, so the section below
// doesn't jump when an error appears.
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
  // When the browser can't store a key, "fields all filled" doesn't count as ready —
  // `ready · using ●●●●99c2` used to render even though not a single byte of the
  // ciphertext had actually been persisted (the same screen's second lie, F-D-14).
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

// ReadyHint — when the browser can't store a key, this whole line yields to the
// vermillion note above it (F-D-14). Leaving it up would be a third lie: all three
// fields are filled, yet it would still shout "fill endpoint, model + key" — telling
// the visitor to redo work that's already done and wouldn't help anyway.
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

// trySubmit — a wrapper that only submits once the form is fully filled; kept at
// file scope so the onSubmit useCallback stays at complexity 1. Invalid input is a
// plain noop — the UI already disables the submit button, this is a second guard.
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
  // Lands on / — byoai state lives in localStorage (use-gate.persistSession),
  // read by the store on page-shell mount; the URL carries no flag. Carries the
  // homepage question through as ?q= (same as the code path).
  ok && router.push(postGateHref());
}
