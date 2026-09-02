// ConnectorSpecIngest —— #155 area A: spec ingestion. owner pastes / uploads / URL-fetches an
// OpenAPI spec -> backend validates it (same 3.0 parser, normalized) -> shows a connector
// candidate (category title) or a human-readable rejection reason.
// First step of spec-driven assembly: feed in a spec from any author's hand.

'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

import {
  useConnectorIngest, type AuthForms, type AuthScheme,
} from '@/lib/admin/use-connector-ingest';
import {
  isAssemblable, type AssembleInput, type AssembleState,
} from '@/lib/admin/use-connector-upload';
import { FilePicker } from '@/components/admin/atoms/FilePicker';
import { ConnectorCredForm } from '@/components/admin/ConnectorCredForm';
import { ConnectorCard } from '@/components/admin/sections/connectors/ConnectorCard';

// ConnectorSpecIngest —— **there is exactly one form for adding a connector** (F-C-21). There
// used to be a second, differently-shaped `{spec, binding}` textarea under the category card;
// navigating to it wiped out whatever was filled in here. Now AssembleView renders this same
// component. "Only one form" means one **implementation**, not one location — the same
// component appearing in two places isn't drift; two different implementations would be.
//
// onAssemble —— assembly (create the connector + store credentials). Only clickable once
// validation passes and a candidate exists: this form **collects everything assembly needs**
// (spec, optional binding, base URL, auth scheme, credentials) — it was previously missing an
// exit for all of it.
// onCandidate —— notifies the parent when validation yields a candidate (the owner has picked
// the "bring your own spec" path). The protocol form under the category card collapses in
// response: the two forms' field testids share the same namespace, and having both on screen at
// once would eventually collide (see AssembleView).
export function ConnectorSpecIngest({ onAssemble, onCandidate, assemble }: {
  onAssemble?: (input: AssembleInput) => void;
  onCandidate?: (has: boolean) => void;
  assemble?: AssembleState;
}) {
  const state = assemble ?? NO_ASSEMBLE;
  return state.id === null
    ? (
      <IngestForm
        onAssemble={onAssemble} onCandidate={onCandidate} assembleError={state.error}
      />
    )
    : <AssembledCard id={state.id} />;
}

// NO_ASSEMBLE —— the empty state when no assemble is passed (the plain-ingest / plain-cred-form
// call paths never need assembly). A constant instead of inline optional chaining: each `?.` in
// that chain counts as a branch and would trip the complexity gate.
const NO_ASSEMBLE: AssembleState = { id: null, error: '' };

// AssembledCard —— once assembly finishes, **the form yields to this card**. The card is the
// sole home for credentials + Connect; leaving the ingest form on screen would let its derived
// connector-connect-button (the one `ConnectMaybe` renders with no onClick) coexist with the
// card's real, working one — a dead button sitting next to a live one.
function AssembledCard({ id }: { id: string }) {
  return <ConnectorCard entry={{ id, category: '', kind: 'openapi' }} />;
}

function IngestForm({ onAssemble, onCandidate, assembleError }: {
  onAssemble?: (input: AssembleInput) => void;
  onCandidate?: (has: boolean) => void;
  assembleError: string;
}) {
  const hook = useConnectorIngest();
  const bindingRef = useRef('');
  const schemeRef = useRef('');
  const credsRef = useRef<Record<string, string>>({});
  // scopesRef —— the oauth2 scopes checked. Stored into the new connector alongside the
  // credentials; missing it means the authorization redirect requests fewer scopes than
  // intended, while the UI looks entirely normal (checkboxes checked, appears to have taken).
  const scopesRef = useRef<Set<string>>(new Set());
  const [expose, setExpose] = useState(false);
  const [useless, setUseless] = useState(false);
  const hasCandidate = hook.candidate !== null;
  useEffect(() => { onCandidate?.(hasCandidate); }, [hasCandidate, onCandidate]);
  // buildInput —— packages everything collected on the form into one assembly call's input.
  // authScheme: if the dropdown was never touched, use the first scheme from the derived form.
  // Leaving it blank means the backend can't pick a unique one among three manual candidates —
  // the connector gets created but the credential form fails to derive.
  const buildInput = (): AssembleInput => ({
    spec: hook.specText(), url: hook.sourceUrl(),
    binding: bindingRef.current, baseUrl: hook.baseUrl(),
    authScheme: schemeRef.current === '' ? defaultScheme(hook.auth) : schemeRef.current,
    exposeAsAgentTools: expose,
    credentials: credsRef.current,
    scopes: [...scopesRef.current],
  });
  // assemble —— what gets assembled must be **usable by someone** (the rule lives in
  // isAssemblable, which is assembly semantics, not this layer). If it isn't usable, reject on
  // the spot and say what's missing, rather than creating a dead object nobody can call.
  const assemble = () => {
    const input = buildInput();
    setUseless(!isAssemblable(input));
    isAssemblable(input) && onAssemble?.(input);
  };
  return (
    <div className="mb-6 border-b border-(--color-rule)/60 pb-6">
      <SpecHeading />
      <SpecTextarea onText={hook.setText} onBlur={hook.submitSpec} />
      <BindingTextarea onText={(t) => { bindingRef.current = t; setUseless(false); }} />
      <BaseUrlRow onText={hook.setBaseUrl} />
      <div className="flex gap-2 mt-2 items-center">
        <SubmitButton onClick={hook.submitSpec} />
        <FileInput onFile={hook.ingestFile} />
      </div>
      <SpecUrlRow onFetch={hook.fetchUrl} />
      <SpecError message={hook.error} />
      <SpecCandidateMaybe candidate={hook.candidate} />
      <CredFormMaybe
        auth={hook.auth}
        onScheme={(s) => { schemeRef.current = s; }}
        values={credsRef.current}
        scopes={scopesRef.current}
      />
      <ExposeRow
        show={hasCandidate}
        checked={expose}
        onChange={(v) => { setExpose(v); setUseless(false); }}
      />
      <UselessWarning show={useless} />
      <AssembleFailure message={assembleError} />
      <AssembleRow show={hasCandidate && onAssemble !== undefined} onClick={assemble} />
    </div>
  );
}

// ExposeRow —— "expose this spec's operations to the visitor AI". **Off by default, the owner
// must check it explicitly** (design source §3: this path is opt-in). It turns every operation
// in the vendor's docs into a tool the visitor AI can call — Cal.com v2 alone has 211 — so this
// is a real grant of external access and must not be inferred from whether binding is empty.
function ExposeRow({ show, checked, onChange }: {
  show: boolean;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  const t = useTranslations('adminShell.specIngest');
  return show ? (
    <label className="mt-4 flex items-start gap-2 cursor-pointer">
      <input
        type="checkbox"
        data-testid="connector-expose-agent-tools"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5"
      />
      <span className="reading-tight text-[12.5px] text-(--color-muted)">{t('exposeLabel')}</span>
    </label>
  ) : null;
}

// AssembleFailure —— the message when assembly genuinely fails (the backend rejected it),
// **shown inside the modal**. A page-level toast isn't enough: the modal covers the whole page
// and the owner can't see it — resulting in "I clicked assemble and nothing happened" (F-C-26).
function AssembleFailure({ message }: { message: string }) {
  return message === '' ? null : (
    <p
      data-testid="connector-assemble-error"
      className="mono text-[12px] text-(--color-accent) mt-3"
    >
      {message}
    </p>
  );
}

// UselessWarning —— the rejection shown when there's no binding and expose isn't checked. It
// names **what's missing**, not "operation failed".
function UselessWarning({ show }: { show: boolean }) {
  const t = useTranslations('adminShell.specIngest');
  return show ? (
    <p
      data-testid="connector-assemble-useless"
      className="mono text-[12px] text-(--color-accent) mt-3"
    >
      {t('needsBindingOrExpose')}
    </p>
  ) : null;
}

// authForms —— the derived list of schemes (empty if none). Split out only to flatten the
// optional-chain branch count: `auth?.forms?.[0]?.scheme ?? ''` has four branches in one line,
// which trips the complexity gate.
function authForms(auth: AuthForms | null): AuthScheme[] {
  return auth === null ? [] : (auth.forms ?? []);
}

// defaultScheme —— the first scheme in the derived form (the effective value when the owner
// hasn't actively chosen one, kept consistent with SchemePicker's default selection). No scheme
// derived at all -> empty string (the case where the spec itself declares a single scheme).
function defaultScheme(auth: AuthForms | null): string {
  return authForms(auth)[0]?.scheme ?? '';
}

// AssembleRow —— the assembly action. **Only appears once there's a candidate**: showing a
// clickable button before the spec has passed validation would make "click and nothing happens"
// the product's behavior.
function AssembleRow({ show, onClick }: { show: boolean; onClick: () => void }) {
  const t = useTranslations('adminShell.specIngest');
  return show ? (
    <div className="mt-4">
      <button
        type="button" onClick={onClick}
        data-testid="connector-assemble-button"
        className="sm-btn sm-btn-solid sm-btn-sm"
      >
        {t('assemble')}
      </button>
    </div>
  ) : null;
}

// BaseUrlRow —— the base URL the owner fills in by hand when the spec doesn't declare `servers`
// (F-C-22). **Always present**, not something that only appears after an error: an input that
// only shows up after failure still leaves the owner with nowhere to type on the first read of
// that rejection.
function BaseUrlRow({ onText }: { onText: (t: string) => void }) {
  const t = useTranslations('adminShell.specIngest');
  return (
    <label className="block mt-2">
      <span className="mono text-[9.5px] tracking-[0.14em] uppercase text-(--color-faint) block mb-1">
        {t('baseUrlLabel')}
      </span>
      <input
        type="text"
        data-testid="connector-spec-base-url"
        onChange={(e) => onText(e.target.value)}
        placeholder="https://api.example.com/v2"
        className="sm-field-input sm-mono"
      />
    </label>
  );
}

// BindingTextarea —— this field used to have **only a placeholder, no label** (UX-81): in the
// same modal, the field above had `PASTE AN OPENAPI SPEC` + an explanatory line, the field
// below had `BASE URL —— ONLY IF…`, and this one alone had neither. And the placeholder text
// "maps operations to a category contract" was this field's **only** explanation — it vanished
// the moment the owner started typing, the classic placeholder-as-label problem.
// The label and explanation are now permanent; the placeholder is back to being just an example.
function BindingTextarea({ onText }: { onText: (t: string) => void }) {
  const t = useTranslations('adminShell.specIngest');
  return (
    <label className="block mt-2">
      <span className="mono text-[9.5px] tracking-[0.14em] uppercase text-(--color-faint) block mb-1">
        {t('bindingLabel')}
      </span>
      <textarea
        data-testid="connector-binding-input"
        onChange={(e) => onText(e.target.value)}
        placeholder={'book:\n  operation: createBooking'}
        rows={4}
        className="w-full bg-transparent border border-(--color-rule) focus:border-(--color-ink) rounded-sm p-2 mono text-[12px]"
      />
      <span className="reading-tight text-[11.5px] text-(--color-muted) block mt-1">
        {t('bindingHint')}
      </span>
    </label>
  );
}

function SpecCandidateMaybe({ candidate }: { candidate: { title: string } | null }) {
  return candidate === null ? null : <SpecCandidate title={candidate.title} />;
}

function CredFormMaybe({ auth, onScheme, values, scopes }: {
  auth: AuthForms | null;
  onScheme: (s: string) => void;
  values: Record<string, string>;
  scopes: Set<string>;
}) {
  return auth === null
    ? null
    : <ConnectorCredForm auth={auth} onScheme={onScheme} values={values} scopes={scopes} />;
}

function SpecHeading() {
  const t = useTranslations('adminShell.specIngest');
  return (
    <div className="mb-2">
      <div className="mono text-[10.5px] tracking-[0.14em] uppercase text-(--color-muted)">
        {t('heading')}
      </div>
      <p className="reading-tight text-[12.5px] text-(--color-muted) mt-1">
        {t('blurb')}
      </p>
    </div>
  );
}

function SpecTextarea({ onText, onBlur }: { onText: (t: string) => void; onBlur: () => void }) {
  return (
    <textarea
      data-testid="connector-spec-input"
      onChange={(e) => onText(e.target.value)}
      onBlur={onBlur}
      placeholder='{ "openapi": "3.0.0", "info": { … }, "servers": [ … ], "paths": { … } }'
      rows={6}
      className="w-full bg-transparent border border-(--color-rule) focus:border-(--color-ink) rounded-sm p-2 mono text-[12px]"
    />
  );
}

function SubmitButton({ onClick }: { onClick: () => void }) {
  const t = useTranslations('adminShell.specIngest');
  return (
    <button
      type="button" onClick={onClick}
      data-testid="connector-spec-submit"
      className="sm-btn sm-btn-solid sm-btn-sm"
    >
      {t('useThisSpec')}
    </button>
  );
}

// FileInput —— uploads a spec file. UX-81 caught the browser's native `Choose File / No file
// chosen` here; now it goes through the FilePicker atom (the same fix stands in two other
// places too — see the atom's docs).
function FileInput({ onFile }: { onFile: (f: File) => void }) {
  const t = useTranslations('adminShell.specIngest');
  return (
    <FilePicker
      label={t('uploadSpec')}
      testid="connector-spec-file"
      accept=".json,.yaml,.yml,application/json,text/yaml"
      onPick={(files) => { const f = files?.[0]; f && onFile(f); }}
    />
  );
}

function SpecUrlRow({ onFetch }: { onFetch: (url: string) => void }) {
  const t = useTranslations('adminShell.specIngest');
  const [url, setUrl] = useState('');
  return (
    <div className="flex gap-2 mt-3 items-end">
      <label className="block flex-1">
        <span className="mono text-[9.5px] tracking-[0.14em] uppercase text-(--color-faint) block mb-1">
          {t('orFetchFromUrl')}
        </span>
        <input
          type="text"
          data-testid="connector-spec-url-input"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://api.example.com/openapi.json"
          className="sm-field-input sm-mono"
        />
      </label>
      {/* FETCH and USE THIS SPEC are **two parallel paths** for submitting a spec; one used to
          be a dark solid button and the other a light text link tucked at the right — a whole
          weight class apart (UX-81). Both mean "submit what's in this field", so they get the
          same outline button; primary/secondary weight is reserved for the real primary action
          below them (ASSEMBLE). */}
      <button
        type="button" onClick={() => onFetch(url)}
        data-testid="connector-spec-fetch-button"
        className="sm-btn sm-btn-outline sm-btn-sm"
      >
        {t('fetch')}
      </button>
    </div>
  );
}

function SpecError({ message }: { message: string }) {
  return message === '' ? null : (
    <p
      data-testid="connector-spec-error"
      className="mono text-[12px] text-(--color-accent) mt-3"
    >
      {message}
    </p>
  );
}

function SpecCandidate({ title }: { title: string }) {
  const t = useTranslations('adminShell.specIngest');
  return (
    <div
      data-testid="connector-candidate"
      className="mt-3 border border-(--color-accent)/50 rounded-sm p-3 bg-(--color-accent)/5"
    >
      <div className="mono text-[10px] tracking-[0.14em] uppercase text-(--color-muted)">
        {t('candidate')}
      </div>
      <div className="text-[14px] mt-0.5">{title}</div>
    </div>
  );
}
