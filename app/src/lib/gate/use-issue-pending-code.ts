// use-issue-pending-code —— the "meeting point" of the defer-issue model.
//
// Scanning a code / clicking a link only pulls the code into the pending
// store, without issuing a session right away (see use-absorb-code). This
// module runs when the name picker is submitted (or skipped): it takes the
// pending code plus the chosen name and actually calls issueCodeSession —
// that way the name **genuinely lands in the backend** = one person = one
// named member = one continuable chat. name=null means skip (anonymous).
//
// member_quota_reached (this code's name slots are full) → returns 'full',
// and the picker shows "code full".

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  issueCodeSession, peekStoredSession, persistSession, seedEphemeralStores,
  usePendingCodeStore, useVisitorSessionStore,
} from '@standmeet/sdk';
import { landAfterIssue, applyLanding } from '@/lib/visitor/code-landing';
import {
  loadMemberID, loadVisitorEmail, loadVisitorName,
  rememberMemberID, rememberVisitorName, rememberVisitorEmail,
} from '@/lib/visitor/visitor-name';

// IssueOutcome —— ok: succeeded; full: name slots are full (picker shows
// "code full"); invalid: the code is invalid/expired (drop pending, fall
// back to public); error: anything else (network hiccup, keep pending so
// it can be retried).
export type IssueOutcome = 'ok' | 'full' | 'invalid' | 'error';

// submitPickerName —— the decision behind the name picker's START button.
// If the name matches the current session → continue the chat: just close
// the picker (consume pending), **don't re-issue** — the backend already
// has the same member and open chat, and re-issuing would trigger the
// frontend's startedAt-reset (clearing the screen) plus an issue response
// with used_turns=0 that looks like it reset to zero. A different name /
// no session yet → actually issue (a new name = a new member = a new
// conversation). Same name on ANOTHER code is not a continuation: the pending code is issued
// (sijie.xyz 2026-10-16 — the new code was dropped and the visitor fell to the public tier).
export async function submitPickerName(
  name: string, email: string,
  issue: (name: string | null, email: string) => Promise<IssueOutcome>,
): Promise<IssueOutcome> {
  const trimmed = name.trim();
  const current = useVisitorSessionStore.getState().session;
  if (current?.visitor === trimmed && current.code === usePendingCodeStore.getState().code) {
    usePendingCodeStore.getState().consume();
    return 'ok';
  }
  rememberVisitorName(trimmed);
  rememberVisitorEmail(email.trim());
  return issue(trimmed, email.trim());
}

// dismissPicker —— skip / click outside the modal. Already has a session
// (the switch-person modal) → cancel, keep the original session (consume,
// don't issue anonymously — otherwise a guest member + new conversation
// would appear out of nowhere). No session yet (first time) → skip =
// anonymous issue.
export async function dismissPicker(
  issue: (name: string | null, email: string) => Promise<IssueOutcome>,
): Promise<IssueOutcome> {
  if (useVisitorSessionStore.getState().session !== null) {
    usePendingCodeStore.getState().consume();
    return 'ok';
  }
  return issue(null, '');
}

type Issue = (name: string | null, email: string) => Promise<IssueOutcome>;

// useAutoSwitch —— presenting a code while a session for a DIFFERENT code is active switches to it
// with no manual step (spec 2026-11-10: "presenting a second access code must switch the session"):
// issue the new code carrying the remembered identity (anonymous if the old session had no name),
// which persists the new session and lands on its page. Returns true while that switch is in flight,
// so the picker shows a "switching" notice instead of an "access granted" form. Fires once per
// presented code. A closed code never reaches here (the picker renders the closed notice instead); a
// full code is reported through onFull, which falls through to the capacity state.
export function useAutoSwitch(code: string | null, issue: Issue, onFull: () => void): boolean {
  // Subscribe for reactivity, but read the code synchronously (peekStoredSession, like the absorb):
  // the zustand session hydrates a tick after mount, so relying on it alone races the picker render —
  // the form would flash before the switch resolves. The synchronous peek makes isSwitch reliable
  // from the first render, so a switch shows the "switching" notice, never the name form.
  const session = useVisitorSessionStore((s) => s.session);
  const sessionCode = session?.code ?? peekStoredSession()?.code ?? null;
  const isSwitch = isDifferentCode(sessionCode, code);
  const fired = useRef('');
  useEffect(() => {
    autoSwitchEffect(isSwitch, code, fired, issue, onFull);
  }, [isSwitch, code, issue, onFull]);
  return isSwitch;
}

// isDifferentCode —— there is a live session, and the presented code is a different one.
function isDifferentCode(sessionCode: string | null, code: string | null): boolean {
  return sessionCode !== null && code !== null && sessionCode !== code;
}

function autoSwitchEffect(
  isSwitch: boolean, code: string | null, fired: { current: string }, issue: Issue, onFull: () => void,
): void {
  const go = isSwitch && fired.current !== code; // isSwitch implies code !== null
  go && fireAutoSwitch(code ?? '', fired, issue, onFull);
}

function fireAutoSwitch(
  code: string, fired: { current: string }, issue: Issue, onFull: () => void,
): void {
  fired.current = code; // once per presented code
  void runAutoSwitch(issue, onFull);
}

async function runAutoSwitch(issue: Issue, onFull: () => void): Promise<void> {
  const named = loadVisitorName().trim();
  const outcome = await (named !== '' ? issue(named, loadVisitorEmail()) : issue(null, ''));
  (outcome === 'full') && onFull();
}

interface IssuePending {
  busy: boolean;
  issue: Issue;
}

export function useIssuePendingCode(): IssuePending {
  const [busy, setBusy] = useState(false);
  const issue = useCallback(async (name: string | null, email: string): Promise<IssueOutcome> => {
    const code = usePendingCodeStore.getState().code;
    if (code === null) return 'error';
    setBusy(true);
    try {
      // Named: resolved by name (the name is the identity; changing the
      // name changes the person). Anonymous (skip): continue with the
      // previously stored member_id (if there is none, the backend creates
      // a fresh guest member). email is optional.
      const sess = await issueCodeSession(
        name === null
          ? { code, member_id: loadMemberID() || undefined }
          : { code, visitor_name: name, visitor_email: email || undefined },
      );
      persistSession(sess, false);
      // F-A-20: this in-page re-issue (switch-name picker) must reseed ALL the ephemeral chat stores
      // from the just-persisted session — dock buttons / tool specs / blocks, not only ghosts.
      // Gate-entry masked the bug because it ends in a navigation (mount → seedEphemeralStores); the
      // in-page switch does not, so without this the new session's dock stayed empty until a reload.
      seedEphemeralStores();
      useVisitorSessionStore.getState().setSession({
        code: sess.code ?? code,
        visitor: sess.visitor_name ?? null,
        byoai: false,
        byoaiProvider: '',
        // Switching names and reopening the session must also carry this
        // code's label — otherwise the strip falls back to the default
        // after switching people (UX-68).
        label: sess.code_label ?? null,
        used: sess.quota.used_turns,
        max: sess.quota.max_turns,
        maxMembers: sess.quota.max_members,
        memberCount: sess.members.length,
        startedAt: Date.now(),
        email: email || '',
        ownerCanDeliver: sess.owner_can_deliver ?? false,
      });
      // Anonymous: store the member_id the backend gave us, so the next
      // skip can continue with the same guest member.
      if (name === null) {
        rememberMemberID(sess.member_id ?? '');
      }
      usePendingCodeStore.getState().consume();
      // Land: a microsite → full nav to /p/<slug> (what you scanned into is
      // what you land on); no microsite → rewrite the URL to /c/<slug> so the
      // raw code leaves the address bar and this chat gets a stable path.
      applyLanding(landAfterIssue(sess.microsite_slug ?? '', sess.slug ?? '', window.location.pathname));
      return 'ok';
    } catch (e) {
      return classifyIssueError(e);
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, issue };
}

// classifyIssueError —— 403 name slots full → 'full' (keep pending, picker
// shows it's at capacity); 401 code invalid/expired → drop pending (picker
// hides) and fall back to public; anything else → 'error', keeping pending
// so the visitor can retry.
function classifyIssueError(e: unknown): IssueOutcome {
  if (isStatus(e, 403)) return 'full';
  if (isStatus(e, 401)) {
    usePendingCodeStore.getState().consume();
    return 'invalid';
  }
  return 'error';
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object';
}

// isStatus —— the error thrown by issueCodeSession carries the backend
// status (attached by the sdk client).
function isStatus(e: unknown, status: number): boolean {
  return isRecord(e) && e['status'] === status;
}
