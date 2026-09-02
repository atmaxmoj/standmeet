// ConnectorOps — on one card, the owner operations this connector **declares itself**
// (backend connector/owner_op.go).
//
// Why this is a generic block instead of a hardcoded "send test email" button on the mail
// card: the declaration is already data — smtp's manifest lists connectors.mail_test_send,
// the catalog carries it along, and this file just renders it as given. Adding an action
// means adding an entry to that connector's manifest; this file doesn't change at all.
// Hardcoding it the other way would put the word "mail" into this generic layer, which is
// exactly what pulling owner-op out into a registry on the backend was meant to avoid.
//
// F-C-12: this panel didn't exist before. The operation, its routing, and failure
// classification were all wired end-to-end on the backend, and five e2e specs already
// exercised it — but all of them went through HTTP/MCP. The owner saves credentials, clicks
// Connect, sees `connected`, and then has no way to know whether mail can actually go out —
// the first real email is sent to a stranger without ever finding out.

'use client';

import { useTranslations } from 'next-intl';

import type { OwnerOp, OwnerOpField } from '@/lib/admin/use-connector-catalog';
import { useConnectorOp, type ConnectorOpHook } from '@/lib/admin/use-connector-op';

// onRan — after an operation finishes, the card has to go re-check its own status
// (F-C-45). These operations **can change connection state**: run a probe after revoking
// access and the backend marks this row disconnected right then, while the card's
// `connected` is still whatever was fetched when the page loaded. Without a refresh, the
// same screen would show two contradicting statements. Re-check after every run, success or
// failure — deciding "only this kind of failure needs a re-check" means recording that
// judgment separately for every operation, and the next one added will forget it.
export function ConnectorOps({ ops, onRan }: { ops: readonly OwnerOp[]; onRan: () => void }) {
  return ops.length === 0 ? null : (
    <div className="mt-3 border-t border-(--color-rule)/60 pt-3 space-y-3">
      {ops.map((op) => <ConnectorOpBlock key={op.name} op={op} onRan={onRan} />)}
    </div>
  );
}

function ConnectorOpBlock({ op, onRan }: { op: OwnerOp; onRan: () => void }) {
  const hook = useConnectorOp(op, onRan);
  return (
    <div data-testid={`connector-op-${hook.segment}`} className="space-y-2">
      <p className="reading-tight text-[12px] text-(--color-muted)">{op.description}</p>
      <OpFields fields={op.fields ?? []} hook={hook} />
      <RunButton hook={hook} />
      <OpResult hook={hook} />
    </div>
  );
}

function OpFields({ fields, hook }: { fields: readonly OwnerOpField[]; hook: ConnectorOpHook }) {
  return (
    <div className="space-y-2">
      {fields.map((f) => (
        <input
          key={f.key}
          data-testid={`connector-op-field-${f.key}`}
          type={inputType(f.type)}
          placeholder={f.key}
          aria-label={f.description ?? f.key}
          onChange={(e) => hook.setField(f.key, e.target.value, f.type ?? 'string')}
          className="sm-field-input sm-mono"
        />
      ))}
    </div>
  );
}

// inputType — if the declaration says this field is a number, give it a number control.
// A declaration's scalar can only be one of these three types (any field that can't be
// derived gets rejected at load time), so there's no need for a fallback "just in case" branch.
function inputType(declared: string | null | undefined): 'text' | 'number' {
  return declared === 'integer' || declared === 'number' ? 'number' : 'text';
}

function RunButton({ hook }: { hook: ConnectorOpHook }) {
  const t = useTranslations('adminIntegrations.connectorOp');
  return (
    <button
      type="button" onClick={hook.run} disabled={hook.running}
      data-testid="connector-op-run"
      className="sm-btn sm-btn-ghost sm-btn-sm"
    >
      {hook.running ? t('running') : t('run')}
    </button>
  );
}

// OpResult — the line shown after a run. Three cases are worded separately, because to the
// owner they're three different things: the request never reached the backend (their
// browser-to-instance leg failed) / the operation ran but failed (the backend's own
// classified message) / it succeeded (and which path it went out on).
function OpResult({ hook }: { hook: ConnectorOpHook }) {
  return hook.outcome === null ? null : (
    <p data-testid="connector-op-result" className="mono text-[11px] text-(--color-accent)">
      <OpResultText outcome={hook.outcome} />
    </p>
  );
}

function OpResultText({ outcome }: { outcome: NonNullable<ConnectorOpHook['outcome']> }) {
  const t = useTranslations('adminIntegrations.connectorOp');
  return <>{resultSentence(outcome, t)}</>;
}

type Translate = ReturnType<typeof useTranslations<'adminIntegrations.connectorOp'>>;

function resultSentence(
  outcome: NonNullable<ConnectorOpHook['outcome']>, t: Translate,
): string {
  return outcome.reached ? reachedSentence(outcome, t) : t('unreachable');
}

function reachedSentence(
  outcome: NonNullable<ConnectorOpHook['outcome']>, t: Translate,
): string {
  return outcome.ok ? successSentence(outcome, t) : failureSentence(outcome.reason, t);
}

// successSentence — use the operation's own sentence when it gives one.
//
// The old sentence (`sent`) was written in an **email voice**: "accepted by the {kind}
// connector — check your inbox to confirm it arrived". It lived in this generic component,
// so any other category's success message read as nonsense — a calendar self-check has no
// inbox. The failure sentence has always come from the operation itself (classified on the
// backend); the success sentence should have worked the same way from the start.
function successSentence(
  outcome: NonNullable<ConnectorOpHook['outcome']>, t: Translate,
): string {
  return outcome.summary === '' ? t('sent', { kind: outcome.viaKind }) : outcome.summary;
}

// failureSentence — the failure line is used **verbatim from the backend**: it's already
// been classified there (fix the config / change the recipient / try again later), and
// wrapping it again here would only dilute it. When the backend gives no reason, don't make
// one up — say plainly that none was given, because "it gave no reason" is itself something
// worth knowing while troubleshooting.
function failureSentence(reason: string, t: Translate): string {
  return reason === '' ? t('failedNoReason') : reason;
}
