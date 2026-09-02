// ConnectorCard — one connector card (built-in or uploaded): derived credentials form
// (connector-field-{key}) + oauth2's redirect-uri (read-only) / scope checklist +
// Connect/Disconnect + status/error. Unification: one card for any kind/auth. Logic lives
// in use-connector-card; this file only renders + wires up (eslint: no if, complexity <=3).

'use client';

import { useTranslations } from 'next-intl';

import { ConnectorOps } from '@/components/admin/sections/connectors/ConnectorOps';
import { SelectField } from '@/components/atoms/SelectField';
import { useConnectorRedirectURI } from '@/lib/admin/redirect-uri';
import { useConnectorCard, type ConnectorCardHook } from '@/lib/admin/use-connector-card';
import type { CatalogEntry } from '@/lib/admin/use-connector-catalog';
import { credFieldLabel } from '@/lib/admin/cred-field-label';

export function ConnectorCard({ entry }: { entry: CatalogEntry }) {
  return (
    <li
      data-testid={`connector-row-${entry.id}`}
      className="crosshair border border-(--color-rule) rounded-sm bg-(--color-surface)/30 p-4"
    >
      <span className="ch-tl" /><span className="ch-br" />
      <ConnectorCardBody entry={entry} />
    </li>
  );
}

// ConnectorCardBody — a card's body: status + derived credentials form + Connect/Disconnect.
//
// **Built-in and owner-uploaded connectors share this same body** (F-C-47). The uploaded
// family used to render only "category / origin / kind / status / delete" — so the product
// let an owner create a connector **with no way to connect it**, while that section's own
// intro read "upload your own (OpenAPI / protocol) connector". The capability was never
// missing: `/{id}/credential-form`, `/{id}/credentials`, `/{id}/connect` all exist for any
// id, and the form is already **derived by the backend from the connector's own declaration**
// — so there's no second UI written here for caldav or any other kind, this just wires the
// same body to the other family of rows.
export function ConnectorCardBody({ entry }: { entry: CatalogEntry }) {
  const hook = useConnectorCard(entry.id);
  return (
    <>
      <CardHead name={cardName(entry)} connected={hook.connected} connecting={hook.connecting} />
      <ScopeShortfallNote missing={hook.missingScopes} />
      <UnreadableNote reason={hook.unreadable} />
      <SchemeSelect schemes={hook.schemes} />
      <Fields hook={hook} />
      <RedirectUri id={entry.id} authType={hook.authType} />
      <Scopes hook={hook} />
      <Actions hook={hook} />
      <ErrorLine error={hook.error} />
      <ConnectorOps ops={entry.owner_ops ?? []} onRan={hook.reloadStatus} />
    </>
  );
}

// cardName — what this card is called.
//
// It always rendered `category`, and **an uploaded connector with no category contract has
// an empty category string** — a vendor like GitHub, which doesn't map onto calendar/mail,
// has only the "expose as an agent tool" path, so it showed up as a nameless box in the list;
// with two rows side by side the owner couldn't tell which vendor was which, and so couldn't
// tell which one to fill credentials for (F-C-56).
//
// A connector with a category is still named by category (`calendar` / `mail` are the owner's
// own vocabulary, closer to what they're trying to do than a vendor name); it only falls back
// to the vendor name when there's no category. When neither exists, fall back to the id —
// **never leave it blank**: a nameless actionable object looks, on screen, exactly like a
// load failure.
function cardName(entry: CatalogEntry): string {
  const named = [entry.category, entry.title ?? '', entry.id].filter((s) => s !== '');
  return named[0] ?? '';
}

function CardHead(
  { name, connected, connecting }: { name: string; connected: boolean; connecting: boolean },
) {
  return (
    <div className="flex items-center justify-between mb-3">
      {/* The card name needs more weight than the fields inside it. It used to be `text-sm`,
          nearly level with the "not connected" to its right and the `bearer` / `TOKEN` below
          it — but this card is an **actionable object**, the fields are its content. The
          GOOGLE CALENDAR card in this same batch was already at this level; the three
          category cards just hadn't caught up yet. */}
      <span
        data-testid="connector-card-name"
        className="font-serif text-[17px] tracking-[-0.01em] text-(--color-ink)"
      >
        {name}
      </span>
      <span data-testid="connector-status" className="mono text-[11px] text-(--color-muted)">
        {statusText(connected, connecting)}
      </span>
    </div>
  );
}

// UnreadableNote — this instance can no longer read this credential (F-C-41).
//
// `INSTANCE_SECRET` really did get rotated once in prod: the backend came up fine, but this
// page rendered **every card** as `not connected` plus a row of empty boxes, not a single
// word about why on screen — a lie about the state of the world (the encrypted value and
// `connected_at` were both still there in the DB), and one that points to an action (re-enter
// credentials), so the owner ends up acting on a configuration they never actually read.
//
// This line sits right under the card name, because the problem is **this card**
// (same rule as F-C-23 putting a rejection right under the field that caused it). The wording
// never mentions the key or the ciphertext: all the owner needs to do is reconnect.
// ScopeShortfallNote — sits right below `connected`: **what this authorization can't do**
// (F-B-8).
//
// Why here: `connected` says "we're holding a token", but the owner reads it as "this
// connection can do whatever it's asked to do". Granting only `calendar.readonly` splits
// those apart — reads work, listing slots works, but writes never will, and that's why
// visitors lose the ability to book a meeting (F-B-8, already pulled from the tool list).
// This card is the only place the owner can see this at all, so the sentence has to sit
// right next to that word.
//
// It names **which scope is missing**, not "some actions are unavailable": the owner's next
// step is to check that box and reconnect, and they can't do that without a name.
function ScopeShortfallNote({ missing }: { missing: readonly string[] }) {
  const t = useTranslations('adminShell.connectorCard');
  return missing.length === 0 ? null : (
    <p
      data-testid="connector-scope-shortfall"
      className="mb-3 mono text-[11px] text-(--color-accent) reading-tight"
    >
      {t('scopeShortfall', { scopes: missing.join(', ') })}
    </p>
  );
}

function UnreadableNote({ reason }: { reason: string }) {
  return reason === '' ? null : (
    <p
      data-testid="connector-unreadable"
      className="mb-3 mono text-[11px] text-(--color-accent) reading-tight"
    >
      {reason}
    </p>
  );
}

// statusText — connecting… (dance in progress; no "connected" substring, so expectConnected
// really waits for the round trip) / connected / not connected.
function statusText(connected: boolean, connecting: boolean): string {
  return connecting ? 'connecting…' : connected ? 'connected' : 'not connected';
}

// SchemeSelect — lets the owner pick an auth method when there's more than one securityScheme
// (renders even for a single scheme, so the assembly test still has something to select).
// Uncontrolled: the connection uses whichever scheme was set when the connector was assembled
// (a single scheme is the only one there is); the option being present is enough for
// selectOption to use it.
function SchemeSelect({ schemes }: { schemes: readonly string[] }) {
  return schemes.length === 0 ? null : (
    <SelectField
      testid="connector-scheme-select"
      defaultValue={schemes[0]}
      className="w-full mb-3"
      mono
    >
      {schemes.map((s) => <option key={s} value={s}>{s}</option>)}
    </SelectField>
  );
}

function Fields({ hook }: { hook: ConnectorCardHook }) {
  return (
    // space-y-4, not space-y-2: once labels were added, one field's height became
    // "label + 6px padding + text + underline", so each label sat closer to the **line above
    // it** than to its **own line** — the eye grouped it with the field above. Fields need
    // more room between them than within them — that's grouping, not a whitespace preference.
    <div className="space-y-4 mb-3">
      <StoredCredsNote show={hook.hasCredentials} />
      {hook.fields.map((key) => <CredField key={key} name={key} onChange={hook.setField} />)}
    </div>
  );
}

// CredField — one credential field, **with a label that stays**.
//
// These fields used to have only a placeholder: `host` / `port` / `username` / `password` /
// `from_address` / `from_name` / `tls` were seven identical-looking boxes, and a placeholder
// vanishes the instant you start typing — by the fourth field you can no longer tell which is
// which (half of UX-58). The field name was always in hand, it just never got rendered as a
// label.
//
// **This only fixes that half**: UX-58 also flagged "no grouping (connection params vs. send
// identity)" and "the `tls` field can't be answered from the form at all (boolean? starttls?
// port?)" — those two need the connector to **declare** its own grouping and field
// descriptions (`CredentialForm` currently only has `Fields []string`), which is new data and
// belongs to the Result column.
//
// Text input has exactly one look in this product: an underline (`.sm-field-input`). These
// credential fields used to be **boxed**, so the same control had two different standards a
// screen apart (UX-59).
function CredField({ name, onChange }: {
  name: string; onChange: (k: string, v: string) => void;
}) {
  return (
    <label className="sm-field">
      <span className="sm-field-label">{credFieldLabel(name)}</span>
      <input
        data-testid={`connector-field-${name}`}
        type={isSecret(name) ? 'password' : 'text'}
        onChange={(e) => onChange(name, e.target.value)}
        className="sm-field-input sm-mono"
      />
    </label>
  );
}

// StoredCredsNote — "this connector already has credentials saved".
//
// The backend **never returns** a credential's value, only `has_credentials: true`
// (verified in connector-security: credential-form only returns field names, not even a
// masked value — stronger than masking, which is correct). But the UI never caught that
// trade-off: a card that says `connected` sits above a row of empty boxes, and **"stored but
// hidden" looks exactly like "nothing configured"** (UX-65). The owner can't tell whether
// they need to re-enter it, and re-entering overwrites good credentials with nothing.
//
// Secrecy is unchanged; this just says out loud a fact the backend already knows: the value
// doesn't come back, but the backend has always been saying whether one **exists**.
function StoredCredsNote({ show }: { show: boolean }) {
  const t = useTranslations('adminShell.connectorCard');
  return show ? (
    <p
      data-testid="connector-creds-stored"
      className="mono text-[11px] text-(--color-muted) reading-tight"
    >
      {t('credsStored')}
    </p>
  ) : null;
}

// isSecret — which credential fields should be masked (key/password/token).
function isSecret(key: string): boolean {
  return /secret|token|password|key/i.test(key);
}

// RedirectUri — oauth2 only: the callback URL the owner registers with the SaaS's OAuth
// client (read-only). **Must be an absolute URL**: the provider's console only accepts a
// full URI (F-C-32). Origin comes from whatever address the owner is currently using to
// visit this page — see lib/admin/redirect-uri.ts.
function RedirectUri({ id, authType }: { id: string; authType: string }) {
  const uri = useConnectorRedirectURI(id);
  return authType === 'oauth2' ? (
    <input
      data-testid="connector-redirect-uri"
      readOnly
      value={uri}
      className="w-full mb-3 bg-(--color-surface)/40 border border-(--color-rule) rounded-sm p-2 mono text-[11px] text-(--color-muted)"
    />
  ) : null;
}

function Scopes({ hook }: { hook: ConnectorCardHook }) {
  return hook.scopes.length === 0 ? null : (
    <div className="space-y-1 mb-3">
      {hook.scopes.map((scope) => (
        <label key={scope} className="flex items-center gap-2 mono text-[11px] text-(--color-muted)">
          <input
            type="checkbox"
            data-testid={`connector-scope-${scope}`}
            // Already-granted scopes must show checked (F-C-33). This used to have neither
            // checked nor defaultChecked — so these boxes could only be written to, never
            // read back, and a live connection looked like it had no permissions at all.
            // Uses defaultChecked + key instead of a controlled input: checked state is owned
            // by the browser (setScope is already persisting it), and key carries `granted` so
            // that when the form re-fetches the granted scopes, this row rebuilds with the
            // new values.
            key={`${scope}:${hook.granted.includes(scope)}`}
            defaultChecked={hook.granted.includes(scope)}
            onChange={(e) => hook.setScope(scope, e.target.checked)}
          />
          {scope}
        </label>
      ))}
    </div>
  );
}

function Actions({ hook }: { hook: ConnectorCardHook }) {
  const t = useTranslations('adminIntegrations.common');
  return (
    <div className="flex gap-2">
      {/* Disabled until the derived form comes back: before that, Connect doesn't know
          whether it should go through the OAuth dance or connect in place, and pressing it
          sends an oauth2 connector down the non-dance path — the owner reads
          "The connection test failed.", a message that belongs to a different path
          (F-C-60). */}
      <button
        type="button" onClick={hook.connect} disabled={!hook.ready}
        data-testid="connector-connect-button"
        className="sm-btn sm-btn-solid sm-btn-sm disabled:opacity-40"
      >
        {t('connect')}
      </button>
      <DisconnectButton hook={hook} />
    </div>
  );
}

function DisconnectButton({ hook }: { hook: ConnectorCardHook }) {
  const t = useTranslations('adminIntegrations.connectorCard');
  return hook.connected ? (
    <button
      type="button" onClick={hook.disconnect}
      data-testid="connector-disconnect-button"
      className="sm-btn sm-btn-ghost sm-btn-sm"
    >
      {t('disconnect')}
    </button>
  ) : null;
}

function ErrorLine({ error }: { error: string }) {
  return error === '' ? null : (
    <p data-testid="connector-error" className="mt-2 mono text-[11px] text-(--color-accent)">
      {error}
    </p>
  );
}
