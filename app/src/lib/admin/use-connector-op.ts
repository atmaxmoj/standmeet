// use-connector-op —— runs an owner operation **a connector declares for
// itself** (see backend connector/owner_op.go).
//
// This surface doesn't know any specific operation: name, description, which
// fields to fill in — all come from the declaration in the catalog. This
// file does exactly two things — collects what the owner filled in, POSTs it
// to that operation's route, and turns whatever comes back into **one result** for the card to render.
//
// A failure message is used verbatim from the backend: it's already been
// classified there (mailFailureReason — fix config / change recipient / try
// again later), with no status codes, hostnames, or stack traces in the
// wording. Wrapping it again on the frontend would only dilute it.

import { useCallback, useRef, useState } from 'react';
import { z } from 'zod';

import type { OwnerOp } from '@/lib/admin/use-connector-catalog';
import { adminAPI } from '@/lib/api/admin';
import { APIError } from '@/lib/api/api-error';

// OP_PREFIX —— every declared operation id starts with this; stripping it
// leaves the route segment. Follows the same convention as the backend's
// declaredOpPrefix (routes/admin/connectors.go) — the route `/connectors/ops/<segment>` was already public.
const OP_PREFIX = 'connectors.';

// OpResultSchema —— what each operation returns is defined by itself, but
// the shared shape is these three things: did it succeed / a plain-language
// sentence if it didn't / which path it went out through if it did. No other field is recognized at this layer, and none should ever surface.
const OpResultSchema = z.object({
  ok: z.boolean().nullish(),
  reason: z.string().nullish(),
  via_kind: z.string().nullish(),
  // summary —— the success sentence, spoken by **the operation itself**.
  // There used to be only via_kind, and the card's success copy read "was
  // accepted by the {kind} connector — check your inbox to confirm": mail
  // phrasing baked into the generic layer, nonsense for a different category
  // (a calendar self-test has no inbox). An operation that can supply a
  // summary uses its own words; one that can't still falls back to the old sentence.
  summary: z.string().nullish(),
});

// OpOutcome —— the result once a run finishes. reason is **the backend's
// exact wording**; viaKind is the kind of the path used on success.
//
// reached is its own field because "the request never went through at all"
// and "the operation ran but didn't succeed" are two different things: the
// latter has already been classified by the backend, the former never even
// got received. Collapsing both into the same ok:false would have the
// screen explain a plain network outage with a classified-result sentence.
export interface OpOutcome {
  reached: boolean;
  ok: boolean;
  reason: string;
  viaKind: string;
  summary: string;
}

export interface ConnectorOpHook {
  segment: string;
  running: boolean;
  outcome: OpOutcome | null;
  setField: (key: string, value: string, type: string) => void;
  run: () => void;
}

// coerce —— converts the string in the input box back according to the
// declared type. Sending a string for a numeric field fails at the op's own
// schema's very first unmarshal step (F-C-17). An empty string is always treated as unfilled, deferring to the op's default.
function coerce(value: string, type: string): string | number | undefined {
  if (value === '') return undefined;
  if (type !== 'integer' && type !== 'number') return value;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

// failedOutcome —— why this run didn't succeed. **If the server answered
// at all, "unreachable" must never be said** (F-C-37).
//
// This used to be `.catch(() => ({ reached: false … }))` — any rejection
// counted as "the request never went through", including a `400 to is
// required`: the backend already stated the reason in 33ms, yet the screen
// sent the owner to go check their network, when all they needed to do was
// fill an address into that box. The three states (never went through / ran
// but didn't succeed / succeeded) are **already part of this component's
// design** (see the comment in ConnectorOps), and they'd been collapsed
// right here — the one place that makes this judgment.
//
// `APIError` is the frontend mirror of the backend's envelope (status + code
// + message); having one in hand already means **the instance answered**:
// that's "ran but didn't succeed", so its message is handed over verbatim. A genuine transport failure never produces an APIError.
function failedOutcome(e: unknown): OpOutcome {
  const answered = e instanceof APIError;
  return {
    reached: answered,
    ok: false,
    reason: answered ? e.message : '',
    viaKind: '',
    summary: '',
  };
}

// onRan —— notifies the card to refetch status once a run finishes (F-C-45).
// These operations can change connection state: run a probe after
// deauthorizing and the backend marks that row disconnected right away,
// while the card's `connected` is still whatever it fetched when the page loaded.
// **Notified regardless of success or failure** — "which kind of failure
// needs a notification" would have to be remembered separately by every operation, and the next one would forget.
export function useConnectorOp(op: OwnerOp, onRan: () => void): ConnectorOpHook {
  const [running, setRunning] = useState(false);
  const [outcome, setOutcome] = useState<OpOutcome | null>(null);
  const values = useRef<Record<string, string | number>>({});
  const segment = op.name.startsWith(OP_PREFIX) ? op.name.slice(OP_PREFIX.length) : op.name;

  const run = useCallback(() => {
    setRunning(true);
    setOutcome(null);
    void adminAPI.post(`/connectors/ops/${segment}`, { ...values.current }, OpResultSchema)
      .then((r) => setOutcome({
        reached: true, ok: r.ok ?? false, reason: r.reason ?? '',
        viaKind: r.via_kind ?? '', summary: r.summary ?? '',
      }))
      .catch((e: unknown) => setOutcome(failedOutcome(e)))
      .finally(() => { setRunning(false); onRan(); });
  }, [segment, onRan]);

  return {
    segment, running, outcome,
    setField: (key, value, type) => { setValue(values.current, key, value, type); },
    run,
  };
}

// setValue —— an empty value removes this field, instead of sending an empty
// string: the op's schema has days as an integer, and sending "" wouldn't
// even parse — the owner's intent was just "I left this field blank".
function setValue(
  bag: Record<string, string | number>, key: string, value: string, type: string,
): void {
  const v = coerce(value, type);
  if (v === undefined) {
    delete bag[key];
    return;
  }
  bag[key] = v;
}
