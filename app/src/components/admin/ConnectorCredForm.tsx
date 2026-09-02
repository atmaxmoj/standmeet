// ConnectorCredForm —— #155 area B: renders a generic credential form from derived auth forms.
// owner pastes a spec -> backend derives from securitySchemes -> this renders the matching
// fields per AuthType (oauth2: client_id/secret/scope/redirect_uri + Connect; apikey: key + a
// placement hint; basic: user/pass; bearer: token). Multiple schemes get a picker. No/unsupported
// auth -> connector-status message. No hand-written form per connector.

'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { SelectField } from '@/components/atoms/SelectField';
import type { AuthField, AuthForms, AuthScheme } from '@/lib/admin/use-connector-ingest';
import { credFieldLabel } from '@/lib/admin/cred-field-label';

// onScheme / values —— the two things the assembly step needs. scheme is the parameter that
// **creates** the connector (written into the manifest); values are the credentials stored
// **into** that connector **after** it's created. Without them, filling in this form has
// nowhere to go (same as [[write-with-no-receipt]]: the token field looks fillable but is
// actually a dead end).
//
// values uses the "caller hands in an object, this writes into it" pattern — the same one
// AssembleView's protocol form uses — to avoid pulling in another state layer for a handful of
// uncontrolled inputs.
export function ConnectorCredForm({ auth, onScheme, values, scopes }: {
  auth: AuthForms;
  onScheme?: (s: string) => void;
  values?: Record<string, string>;
  scopes?: Set<string>;
}) {
  return (
    <div data-testid="connector-cred-form" className="mt-4 border-t border-(--color-rule)/60 pt-4">
      <CredNote note={auth.note ?? ''} />
      <SchemePicker forms={auth.forms ?? []} onScheme={onScheme} values={values} scopes={scopes} />
    </div>
  );
}

function CredNote({ note }: { note: string }) {
  return note === ''
    ? null
    : <p data-testid="connector-status" className="mono text-[12px] text-(--color-accent)">{note}</p>;
}

function SchemePicker({ forms, onScheme, values, scopes }: {
  forms: AuthScheme[];
  onScheme?: (s: string) => void;
  values?: Record<string, string>;
  scopes?: Set<string>;
}) {
  const [scheme, setScheme] = useState('');
  const selected = forms.find((f) => f.scheme === scheme) ?? forms[0];
  const pick = (s: string) => { setScheme(s); onScheme?.(s); };
  return selected === undefined
    ? null
    : (
      <SchemePickerBody
        forms={forms} selected={selected} onScheme={pick} values={values} scopes={scopes}
      />
    );
}

function SchemePickerBody({
  forms, selected, onScheme, values, scopes,
}: {
  forms: AuthScheme[];
  selected: AuthScheme;
  onScheme: (s: string) => void;
  values?: Record<string, string>;
  scopes?: Set<string>;
}) {
  return (
    <>
      <SchemeSelectMaybe forms={forms} value={selected.scheme} onChange={onScheme} />
      <SchemeBody form={selected} values={values} scopes={scopes} />
    </>
  );
}

function SchemeSelectMaybe({
  forms, value, onChange,
}: { forms: AuthScheme[]; value: string; onChange: (s: string) => void }) {
  const t = useTranslations('adminShell.connectorCred');
  return forms.length <= 1 ? null : (
    <label className="block mb-3">
      <span className="mono text-[10px] tracking-[0.14em] uppercase text-(--color-muted) block mb-1">
        {t('authentication')}
      </span>
      <SelectField
        testid="connector-scheme-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        mono
      >
        {forms.map((f) => <option key={f.scheme} value={f.scheme}>{f.scheme}</option>)}
      </SelectField>
    </label>
  );
}

function SchemeBody({ form, values, scopes }: {
  form: AuthScheme;
  values?: Record<string, string>;
  scopes?: Set<string>;
}) {
  return (
    <div className="space-y-3">
      {form.fields.map((f) => <CredField key={f.key} field={f} values={values} scopes={scopes} />)}
      <ApiKeyHint form={form} />
      <DiscoveryHint form={form} />
      <ConnectMaybe form={form} />
    </div>
  );
}

const codeTag = (chunks: ReactNode) => <code className="mono">{chunks}</code>;

function ApiKeyHint({ form }: { form: AuthScheme }) {
  return form.type === 'apikey' ? <ApiKeyHintBody form={form} /> : null;
}

function ApiKeyHintBody({ form }: { form: AuthScheme }) {
  const t = useTranslations('adminShell.connectorCred');
  return (
    <p className="reading-tight text-[12px] text-(--color-muted)">
      {t.rich('apiKeyHint', { where: form.in ?? '', name: form.param_name ?? '', code: codeTag })}
    </p>
  );
}

function DiscoveryHint({ form }: { form: AuthScheme }) {
  const url = form.discovery_url ?? '';
  return url === '' ? null : <DiscoveryHintBody url={url} />;
}

function DiscoveryHintBody({ url }: { url: string }) {
  const t = useTranslations('adminShell.connectorCred');
  return (
    <p className="reading-tight text-[12px] text-(--color-muted)">
      {t.rich('discoveryHint', { url, code: codeTag })}
    </p>
  );
}

// NeedsDanceNote —— "this scheme requires an authorization redirect" is a **real signal** the
// owner should see while filling in credentials.
//
// But this used to render a `connector-connect-button` **button with no onClick** (F-C-24). The
// consequence isn't "missing a feature": on the assembly path, the owner (and e2e) could click
// it and nothing would happen, with no on-screen sign that it "didn't work" — only after a
// 15-second poll timeout would it become clear the connection was never initiated. Connecting is
// the **card's** job (only the card has the connector id); the ingest form never had the ability
// to connect. And having two same-named testids present at once made locators collide too.
//
// So the signal stays, the element changes: say it in words, don't leave an unclickable button.
function ConnectMaybe({ form }: { form: AuthScheme }) {
  return form.needs_dance ? <NeedsDanceNote /> : null;
}

function NeedsDanceNote() {
  const t = useTranslations('adminShell.connectorCred');
  return (
    <p
      data-testid="connector-needs-dance"
      className="reading-tight text-[12px] text-(--color-muted)"
    >
      {t('needsDance')}
    </p>
  );
}

function CredField({ field, values, scopes }: {
  field: AuthField;
  values?: Record<string, string>;
  scopes?: Set<string>;
}) {
  return field.type === 'scopes'
    ? <ScopeField field={field} scopes={scopes} />
    : <PlainField field={field} values={values} />;
}

// ScopeField —— the oauth2 scope multi-select. Checked results are written into scopes (same
// pattern as values: the caller hands in a container, this writes into it). **Without it these
// checkboxes have nowhere to go once checked** — the credentials sent during assembly would
// carry no scope, the authorization redirect would request fewer scopes, and the UI would look
// entirely normal.
// toggleScope —— add on check, delete on uncheck. Split out only to flatten the branches (an
// inline ternary plus two optional chains trips the complexity gate).
function toggleScope(scopes: Set<string>, s: string, on: boolean): void {
  on ? scopes.add(s) : scopes.delete(s);
}

function ScopeField(
  { field, scopes = new Set<string>() }: { field: AuthField; scopes?: Set<string> },
) {
  const t = useTranslations('adminShell.connectorCred');
  const all = field.scopes ?? [];
  // Everything is checked by default -> the container's initial value must also be all-checked,
  // otherwise "never clicked at all" would be read as "nothing selected".
  all.forEach((s) => scopes.add(s));
  return (
    <div>
      <span className="mono text-[10px] tracking-[0.14em] uppercase text-(--color-muted) block mb-1">
        {t('scopes')}
      </span>
      <div data-testid={`connector-field-${field.key}`} className="flex flex-wrap gap-1.5">
        {all.map((s) => (
          <label key={s} className="mono text-[11px] flex items-center gap-1">
            <input
              type="checkbox" defaultChecked data-testid={`connector-scope-${s}`}
              onChange={(e) => { toggleScope(scopes, s, e.target.checked); }}
            />
            {s}
          </label>
        ))}
      </div>
    </div>
  );
}

function PlainField({ field, values }: { field: AuthField; values?: Record<string, string> }) {
  const readonly = field.type === 'readonly';
  return (
    <label className="block">
      <span className="mono text-[10px] tracking-[0.14em] uppercase text-(--color-muted) block mb-1">
        {credFieldLabel(field.key)}
      </span>
      <input
        type={field.type === 'password' ? 'password' : 'text'}
        data-testid={`connector-field-${field.key}`}
        readOnly={readonly}
        defaultValue={readonly ? '/api/admin/connectors/{id}/callback' : ''}
        onChange={(e) => { values && (values[field.key] = e.target.value); }}
        className="w-full bg-transparent border-b border-(--color-rule) focus:border-(--color-ink) py-1.5 mono text-[12px]"
      />
    </label>
  );
}
