// use-upgrade —— data layer for the "upgrade" cell on /admin/system.
//
// Two things, kept sharply separate:
//   check()  which version this instance is running, which version has been
//     released, and whether it can be applied
//   apply()  asks the orchestrator to redeploy, **then measures the outcome**
//
// Measuring the outcome is the crux. The backend can only report "the
// request went out" — it is itself part of what's being replaced, and
// doesn't survive to answer "did the upgrade actually succeed". "Went out"
// and "went through" are two different things: the hook fires, the
// orchestrator does redeploy, but if compose pins the image tag, the version
// won't change one bit. So this file polls /api/v1/instance's version from
// the browser instead — the browser stays alive through the restart, so it can measure it.
//
// If no change can be measured, it honestly says "redeployed, version
// unchanged"; a 200 from the hook is never enough on its own to declare the upgrade a success.

'use client';

import { useCallback, useState } from 'react';
import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';

const UpgradeCheckSchema = z.object({
  current: z.string(),
  latest: z.string(),
  error: z.string(),
  comparable: z.boolean(),
  available: z.boolean(),
  can_apply: z.boolean(),
});
export type UpgradeCheck = z.infer<typeof UpgradeCheckSchema>;

// Restart budget: pulling five images + bringing dependencies up, a few minutes is normal on a slow machine.
const POLL_BUDGET_MS = 300_000;
const POLL_EVERY_MS = 3_000;

export type UpgradePhase = 'idle' | 'checking' | 'applying' | 'settled';

// UpgradeOutcome —— the result **actually measured** after apply(), not the hook's return code.
export type UpgradeOutcome =
  | { kind: 'upgraded'; version: string }
  | { kind: 'unchanged'; version: string }
  | null;

export interface UpgradeHook {
  check: UpgradeCheck | null;
  phase: UpgradePhase;
  outcome: UpgradeOutcome;
  runCheck: () => Promise<void>;
  apply: () => Promise<void>;
}

export function useUpgrade(): UpgradeHook {
  const [check, setCheck] = useState<UpgradeCheck | null>(null);
  const [phase, setPhase] = useState<UpgradePhase>('idle');
  const [outcome, setOutcome] = useState<UpgradeOutcome>(null);

  const runCheck = useCallback(async () => {
    setPhase('checking');
    try {
      setCheck(await adminAPI.get('/upgrade', UpgradeCheckSchema));
    } finally {
      setPhase('idle');
    }
  }, []);

  const apply = useCallback(async () => {
    const before = check?.current ?? '';
    setPhase('applying');
    setOutcome(null);
    try {
      await adminAPI.post('/upgrade', {}, z.object({ requested: z.boolean() }));
      setOutcome(await waitForRestart(before));
    } finally {
      setPhase('settled');
    }
  }, [check]);

  return { check, phase, outcome, runCheck, apply };
}

// waitForRestart —— watches /api/v1/instance's version until it changes or the budget runs out.
// Requests will fail mid-restart (the container is being swapped) — that's expected, not conclusive, so it keeps waiting.
async function waitForRestart(before: string): Promise<UpgradeOutcome> {
  const deadline = Date.now() + POLL_BUDGET_MS;
  let seen = before;
  while (Date.now() < deadline) {
    await sleep(POLL_EVERY_MS);
    const now = await liveVersion();
    if (now !== '' && now !== before) {
      return { kind: 'upgraded', version: now };
    }
    seen = now === '' ? seen : now;
  }
  return { kind: 'unchanged', version: seen };
}

// liveVersion —— returns an empty string when it can't get one. An empty
// string means "couldn't ask this round", not "the version is empty" —
// conflating the two would let one failure mid-restart get treated as conclusive.
async function liveVersion(): Promise<string> {
  try {
    const res = await fetch('/api/v1/instance', { cache: 'no-store' });
    const body: unknown = res.ok ? await res.json() : {};
    return z.object({ version: z.string() }).catch({ version: '' }).parse(body).version;
  } catch {
    return '';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

// —— what the panel displays ——
//
// Branching lives here, not in the component (same place as deployView /
// resourceStats): the presentation layer only hands the key off to t().
// This isn't just to pass the gate — "should the button say upgrade" is a
// **judgment**, and a judgment can only be verified once it has a name.

export interface UpgradeView {
  lineKey: string;
  lineParams: Record<string, string>;
  buttonKey: string;
  buttonParams: Record<string, string>;
  busy: boolean;
  canApply: boolean;
}

export function upgradeView(h: UpgradeHook): UpgradeView {
  const line = lineOf(h);
  return {
    lineKey: line.key,
    lineParams: line.params,
    buttonKey: buttonKeyOf(h),
    buttonParams: { version: h.check?.latest ?? '' },
    busy: h.phase === 'checking' || h.phase === 'applying',
    canApply: canApply(h.check),
  };
}

// canApply —— a new version exists **and** this instance can apply it.
// Neither condition can be dropped: without the second, the button becomes
// an "upgrade" that does nothing when pressed — worse than not having the button at all.
function canApply(c: UpgradeCheck | null): boolean {
  return c !== null && c.available && c.can_apply;
}

function buttonKeyOf(h: UpgradeHook): string {
  if (h.phase === 'applying') { return 'upgradeApplying'; }
  if (h.phase === 'checking') { return 'upgradeChecking'; }
  return canApply(h.check) ? 'upgradeTo' : 'checkForUpdates';
}

interface Line { key: string; params: Record<string, string> }

// lineOf —— the outcome takes priority over the check: once one upgrade has run, the reader wants to know "did it actually go through".
function lineOf(h: UpgradeHook): Line {
  if (h.outcome !== null) { return outcomeLine(h.outcome); }
  if (h.phase === 'applying') { return { key: 'upgradeWaiting', params: {} }; }
  return checkLine(h.check);
}

function outcomeLine(o: NonNullable<UpgradeOutcome>): Line {
  return o.kind === 'upgraded'
    ? { key: 'upgradeDone', params: { version: o.version } }
    : { key: 'upgradeStalled', params: { version: o.version } };
}

function checkLine(c: UpgradeCheck | null): Line {
  if (c === null) { return { key: 'upgradeUnknown', params: {} }; }
  if (c.error !== '') { return { key: 'upgradeUnreachable', params: {} }; }
  // "Can't compare" is not "already up to date". An unstamped build's (one
  // built from source directly) version number isn't a release tag, and
  // reporting "you're already on the latest" would be a lie — state the
  // latest version anyway and let the reader judge for themselves.
  if (!c.comparable) {
    return { key: 'upgradeIncomparable', params: { version: c.latest, current: c.current } };
  }
  return c.available ? availableLine(c) : { key: 'upgradeCurrent', params: { version: c.current } };
}

// availableLine —— a new version exists, but **whether this instance can
// apply it** decides which sentence is shown. If it can't, say clearly why
// and how to upgrade instead — glossing over it is not allowed.
function availableLine(c: UpgradeCheck): Line {
  return {
    key: c.can_apply ? 'upgradeAvailable' : 'upgradeManual',
    params: { version: c.latest },
  };
}
