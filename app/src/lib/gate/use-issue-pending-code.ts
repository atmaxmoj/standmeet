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

import { useCallback, useState } from 'react';

import { issueCodeSession } from '@/lib/api/public';
import { persistSession } from '@/lib/gate/use-gate';
import { usePendingCodeStore } from '@/lib/gate/use-pending-code-store';
import { useVisitorSessionStore } from '@/lib/visitor/session-store';
import { codeLandingHref } from '@/lib/visitor/code-landing';
import { seedEphemeralStores } from '@/lib/page/use-chat-restore';
import {
  loadMemberID, rememberMemberID, rememberVisitorName, rememberVisitorEmail,
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
// conversation).
export async function submitPickerName(
  name: string, email: string,
  issue: (name: string | null, email: string) => Promise<IssueOutcome>,
): Promise<IssueOutcome> {
  const trimmed = name.trim();
  const current = useVisitorSessionStore.getState().session?.visitor ?? null;
  if (current !== null && trimmed === current) {
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

interface IssuePending {
  busy: boolean;
  issue: (name: string | null, email: string) => Promise<IssueOutcome>;
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
      // from the just-persisted session — dock buttons / tool specs / capabilities, not only ghosts.
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
      // If this code is bound to a page → switch to that page in place.
      // **What you scanned into should be what you land on**; staying on
      // the default chat means the rendering the owner built might as well
      // not exist. A full-page navigation (not router.push) is deliberate:
      // that page is a build artifact, not part of this Next app's route tree.
      goToCodeLanding(sess.custom_page_slug ?? '');
      return 'ok';
    } catch (e) {
      return classifyIssueError(e);
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, issue };
}

function goToCodeLanding(slug: string): void {
  const href = codeLandingHref(slug);
  if (href === '' || typeof window === 'undefined') return;
  window.location.assign(href);
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
