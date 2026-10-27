// visitor-root.tsx — the client strategy at `/` for a visitor who arrived with a code.
//
// The middleware serves the codeless custom `home` page at `/`; it deliberately does NOT rewrite
// when the URL carries ?code=, so a coded visitor reaches this component instead. It restores the
// coded half of the old page-shell (the homepage half became a microsite). The owner's model:
//
//   • a code may have a microsite attached (session.microsite_slug) → the visitor lands on
//     THAT page (/p/<slug>), whose AgentWidget adopts the session — this redirect is owned by
//     use-issue-pending-code / use-absorb-code's landOnRendering, not here;
//   • no attached page → the ORIGINAL built-in coded chat (ChatRoom).
//
// While the code is still pending (absorbed from ?code= but no name picked yet), the
// VisitorNamePicker overlays the identity fallback; picking a name issues the session and this
// re-renders into ChatRoom (or the microsite redirect fires first).

'use client';

import { useEffect, type ReactElement } from 'react';

import { ChatRoom } from '@/components/visitor/ChatRoom';
import { VisitorNamePicker } from '@/components/visitor/VisitorNamePicker';
import { DefaultHome } from '@/app/default-home';
import { useAbsorbCodeFromURL } from '@/lib/gate/use-absorb-code';
import {
  useVisitorSessionStore, bindVisitorSessionSync,
  type SessionMode, type VisitorSession,
} from '@standmeet/sdk';
import { useShouldAskVisitorName } from '@/lib/visitor/visitor-name';
import { useLeaveForHome } from '@/lib/visitor/use-leave-for-home';

export function VisitorRoot({ name, handle, hasCode, hasQuestion }: {
  name: string; handle: string; hasCode: boolean; hasQuestion: boolean;
}) {
  // Hydrate the session store from localStorage on mount (a returning visitor's session lives
  // there). The old long-scroll did this via its <SessionStrip>; the fallback branch below has
  // none, so without this a returning visitor's session never loads and `/` never becomes chat.
  useEffect(() => bindVisitorSessionSync(), []);
  // Mounts the ?code= absorb: stores the pending code + strips it from the URL. Issuing the
  // session (and any microsite redirect) is deferred to the name picker's path.
  useAbsorbCodeFromURL();
  const session = useVisitorSessionStore((s) => s.session);
  const pending = useShouldAskVisitorName();
  const els: Record<VisitorView, ReactElement> = {
    chat: <ChatRoom owner={{ handle, full_name: name, location: '' }} mode={sessionMode(session)} />,
    picker: <VisitorNamePicker />,
    fallback: <DefaultHome name={name} handle={handle} />,
  };
  const view = chooseVisitorView(session, pending, hasCode, hasQuestion);
  useLeaveForHome(view === 'fallback', session);
  return els[view];
}

export type VisitorView = 'chat' | 'picker' | 'fallback';

// chooseVisitorView —— the pure render decision at `/`, extracted so a race that only shows up in
// timing (the ?code= absorb setting `pending` a tick after the first paint) can be pinned
// DETERMINISTICALLY in a unit test, and so the component stays under the complexity cap. Rules:
//   • a live coded/byoai session → the chat;
//   • a pending code, OR `hasCode` (the server saw ?code= in the URL) → the name picker. `hasCode`
//     covers the first paint BEFORE the client absorb runs, so HomeFallback never flashes for a
//     coded visitor — that flash was the intermittent "page under construction" a recruiter saw;
//   • a codeless visitor who arrived with a question (`hasQuestion`, ?q= from a reader's ask) →
//     the chat on the owner's PUBLIC model, which auto-asks that question (ChatRoom, mode public).
//     This replaces the old bounce to /gate's BYOAI panel: the owner's model answers it directly,
//     and only when that model is unavailable does ChatRoom fall to /gate (public-exhaustion
//     hand-off). The middleware serves the home microsite for a bare `/`, so a codeless visitor
//     here always carries a ?q=;
//   • otherwise (genuinely codeless, no question, no live home) → HomeFallback.
export function chooseVisitorView(
  session: VisitorSession | null, pending: boolean, hasCode: boolean, hasQuestion: boolean,
): VisitorView {
  // A PENDING code wins over an existing chat: the absorb only sets `pending` for a NEW code (it skips
  // re-absorbing the same named session), so a pending code while in a session means the visitor
  // opened a DIFFERENT code — show the picker to switch to it (owner: opening HIRING-2026xxxx while in
  // HIRING-2026 must not silently stay in the old chat).
  return pending ? 'picker' : viewFor(isChatSession(session), hasCode, hasQuestion);
}

function viewFor(inChat: boolean, coded: boolean, hasQuestion: boolean): VisitorView {
  return inChat ? 'chat' : codelessOrCoded(coded, hasQuestion);
}

// codelessOrCoded — no live session: a code (fresh or pending) → the picker; a codeless visitor
// with a ?q= → the public chat; otherwise the identity fallback.
function codelessOrCoded(coded: boolean, hasQuestion: boolean): VisitorView {
  return coded ? 'picker' : hasQuestion ? 'chat' : 'fallback';
}

// sessionMode — public until a session exists; then byoai or code.
function sessionMode(session: VisitorSession | null): SessionMode {
  return session === null ? 'public' : session.byoai ? 'byoai' : 'code';
}

// isChatSession — a live coded / byoai session means the focused chat, not the identity fallback.
function isChatSession(session: VisitorSession | null): boolean {
  return session !== null && (session.code !== null || session.byoai);
}
