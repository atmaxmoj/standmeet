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

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { ChatRoom } from '@/components/visitor/ChatRoom';
import { VisitorNamePicker } from '@/components/visitor/VisitorNamePicker';
import { HomeFallback } from '@/app/home-fallback';
import { useAbsorbCodeFromURL } from '@/lib/gate/use-absorb-code';
import { usePendingCodeStore } from '@/lib/gate/use-pending-code-store';
import {
  useVisitorSessionStore, bindVisitorSessionSync, type VisitorSession,
} from '@/lib/visitor/session-store';
import type { SessionMode } from '@/lib/page/use-chat';

export function VisitorRoot({ name, handle }: { name: string; handle: string }) {
  // Hydrate the session store from localStorage on mount (a returning visitor's session lives
  // there). The old long-scroll did this via its <SessionStrip>; the fallback branch below has
  // none, so without this a returning visitor's session never loads and `/` never becomes chat.
  useEffect(() => bindVisitorSessionSync(), []);
  // Mounts the ?code= absorb: stores the pending code + strips it from the URL. Issuing the
  // session (and any microsite redirect) is deferred to the name picker's path.
  useAbsorbCodeFromURL();
  const session = useVisitorSessionStore((s) => s.session);
  useCodelessQuestionHandoff(session);
  return isChatSession(session)
    ? <ChatRoom owner={{ handle, full_name: name, location: '' }} mode={sessionMode(session)} />
    : (
      <>
        <VisitorNamePicker />
        <HomeFallback name={name} handle={handle} />
      </>
    );
}

// useCodelessQuestionHandoff — a codeless visitor arriving with a question in the URL (?q=, e.g. a
// reader's AskAboutThis "action=/" form) is handed off to /gate carrying the question, exactly as
// the old page-shell's useConsumeQuestionFromURL did. Skipped once a session exists (ChatRoom
// auto-asks the ?q= itself) or a code is pending (the name picker takes over and ?q= rides through
// the gate). The ?code= absorb above runs first, so a pending code is already visible here.
function useCodelessQuestionHandoff(session: VisitorSession | null): void {
  const router = useRouter();
  useEffect(() => {
    const target = codelessQuestionTarget(session);
    target && router.replace(target);
  }, [session, router]);
}

// codelessQuestionTarget — the /gate URL to hand a codeless question off to, or '' when there's
// nothing to hand off (a session is live, a code is pending, or there's no ?q= in the URL).
function codelessQuestionTarget(session: VisitorSession | null): string {
  const q = isIdleVisitor(session) ? new URL(window.location.href).searchParams.get('q') : null;
  return q ? `/gate?q=${encodeURIComponent(q)}` : '';
}

// isIdleVisitor — no live session and no code being redeemed: the only state where a bare ?q= in
// the URL is a codeless question to forward (not one ChatRoom or the name picker already owns).
function isIdleVisitor(session: VisitorSession | null): boolean {
  return session === null && usePendingCodeStore.getState().code === null;
}

// sessionMode — public until a session exists; then byoai or code.
function sessionMode(session: VisitorSession | null): SessionMode {
  return session === null ? 'public' : session.byoai ? 'byoai' : 'code';
}

// isChatSession — a live coded / byoai session means the focused chat, not the identity fallback.
function isChatSession(session: VisitorSession | null): boolean {
  return session !== null && (session.code !== null || session.byoai);
}
