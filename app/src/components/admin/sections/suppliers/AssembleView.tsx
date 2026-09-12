// AssembleView — the unified assembly view (one per seam). Owner picks one of two paths:
// upload an OpenAPI spec to assemble a per-SaaS supplier (openapi path), or fill the fixed
// form of a built-in protocol (CalDAV/SMTP) to connect directly (protocol path).
// Unification: both kinds share one view and, once connected, run the same seam contract.
//
// **The openapi half renders the real SupplierSpecIngest, not a second form hand-rolled here**
// (F-C-21). This used to have a textbox that only accepted one JSON blob `{ spec, binding }` —
// a different payload shape from the catalog-level form, and it wiped whatever candidate/plan/
// token was already filled when arriving from the catalog. Two implementations is drift itself.
//
// The seam-card entry point stays for a reason: an owner clicking into Calendar who only
// sees CalDAV won't know they can bring their own OpenAPI calendar too. But **seam has no
// effect on the openapi path** — the seam is declared by the binding (backend BindingSeam),
// not by which card was clicked.

'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { useProtocolConnect, type ProtocolConnectHook } from '@/lib/admin/use-protocol-connect';
import {
  protocolForSeam, seedDefaults, fieldDefault, type AssembleField,
} from '@/lib/admin/assemble-fields';
import { SupplierSpecIngest } from '@/components/admin/SupplierSpecIngest';
import type { AssembleInput, AssembleState } from '@/lib/admin/use-supplier-upload';

export function AssembleView({ seam, onAssemble, assemble }: {
  seam: string;
  onAssemble?: (input: AssembleInput) => void;
  assemble?: AssembleState;
}) {
  const [specChosen, setSpecChosen] = useState(false);
  return (
    <div className="sm-supplier-modal-body space-y-5">
      <SupplierSpecIngest
        onAssemble={onAssemble} onCandidate={setSpecChosen} assemble={assemble}
      />
      <ProtocolFormMaybe seam={seam} hidden={specChosen} />
    </div>
  );
}

// ProtocolFormMaybe — collapses the protocol form once the spec validates into a candidate.
// Two reasons, one product-facing and one mechanical:
//
// Product — the owner already picked "bring your own OpenAPI"; showing a CalDAV credentials
// form on the same screen is exactly the "two forms doing the same thing, differently" item
// the LOOK line warns about.
//
// Mechanical — both forms share the same field testid namespace (supplier-field-{key}).
// They happen not to collide today because oauth2 derives client_id/client_secret while
// CalDAV uses url/username/password; a spec declaring basic auth would derive username/
// password and collide on the spot. **Relying on field names happening not to repeat**
// is not a guarantee.
function ProtocolFormMaybe({ seam, hidden }: { seam: string; hidden: boolean }) {
  return hidden ? null : <ProtocolForm seam={seam} />;
}

// ProtocolForm — fixed credentials form for a built-in protocol (CalDAV/SMTP) + connect
// (use-protocol-connect creates the supplier, stores credentials, and runs the connect test).
function ProtocolForm({ seam }: { seam: string }) {
  const proto = protocolForSeam(seam);
  return proto === undefined ? null : <ProtocolFields seam={seam} proto={proto} />;
}

function ProtocolFields(
  { seam, proto }: { seam: string; proto: NonNullable<ReturnType<typeof protocolForSeam>> },
) {
  const hook = useProtocolConnect(proto.protocol, seam);
  const [values] = useState<Record<string, string>>(() => seedDefaults(proto.fields));
  return (
    <div className="space-y-2">
      {proto.fields.map((f) => (
        <TextField key={f.k} field={f} onChange={(v) => { values[f.k] = v; }} />
      ))}
      <ConnectRow hook={hook} onConnect={() => { hook.saveAndConnect(values); }} />
    </div>
  );
}

function TextField({ field, onChange }: { field: AssembleField; onChange: (v: string) => void }) {
  const t = useTranslations('adminIntegrations.assemble');
  return (
    <input
      data-testid={`supplier-field-${field.k}`}
      type={field.secret ? 'password' : 'text'}
      placeholder={t(`field.${field.k}`)}
      defaultValue={fieldDefault(field)}
      onChange={(e) => onChange(e.target.value)}
      className="sm-field-input sm-mono"
    />
  );
}

// ConnectRow — the Connect button + status/error for the protocol path. save() creates the
// supplier and stores credentials, then runs the real connect test.
function ConnectRow({ hook, onConnect }: { hook: ProtocolConnectHook; onConnect: () => void }) {
  const t = useTranslations('adminIntegrations.common');
  const ta = useTranslations('adminIntegrations.assemble');
  return (
    <div className="pt-2 space-y-2">
      <button
        type="button"
        data-testid="supplier-connect-button"
        onClick={() => { onConnect(); hook.connect(); }}
        className="sm-btn sm-btn-solid sm-btn-sm"
      >
        {t('connect')}
      </button>
      <p data-testid="supplier-status" className="mono text-[11px] text-(--color-muted)">
        {ta(protoStatusKey(hook.status))}
      </p>
      <ProtoError error={hook.error} />
    </div>
  );
}

// protoStatusKey — "connecting…" has no "connected" substring, so expectConnected really
// waits for connect to settle.
function protoStatusKey(status: string): string {
  return status === 'connected' ? 'statusConnected'
    : status === 'connecting' ? 'statusConnecting' : 'statusNotConnected';
}

function ProtoError({ error }: { error: string }) {
  return error === '' ? null : (
    <p data-testid="supplier-error" className="mono text-[11px] text-(--color-accent)">{error}</p>
  );
}
