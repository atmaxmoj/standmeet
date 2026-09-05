// code-panel-logic —— business logic + state derivation for the gate
// CodePanel. Pulled out of the component file (the presentation layer is
// not allowed to run `if` / async / control flow).
//
// Behavior mirrors docs/design/project/gate.js CodeInput: normalize to
// uppercase + strip non-[A-Z0-9-] + 32-char cap; paste auto-submits;
// a wrong code → shake + clear + refocus.

import { loadStoredSession, type GateHook } from '@/lib/gate/use-gate';
import { codeLandingHref } from '@/lib/visitor/code-landing';

export function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 32);
}

// codeReady —— the enter button becomes clickable only once the input is
// long enough (≥ 3 chars after stripping dashes).
export function codeReady(code: string): boolean {
  return code.replace(/-/g, '').length >= 3;
}

// codeShapedForAutoSubmit —— whether the pasted text looks like a code
// (≥ 4 chars after stripping dashes), worth auto-running a submit;
// otherwise it just sits in the input waiting for the user to type more.
export function codeShapedForAutoSubmit(code: string): boolean {
  return code.replace(/-/g, '').length >= 4;
}

// handlePasteEvent —— handles the onPaste event: extracts text, normalizes
// it, feeds it into apply. An empty clipboard returns immediately without
// calling preventDefault (letting React handle it itself).
export function handlePasteEvent(
  e: React.ClipboardEvent<HTMLInputElement>,
  apply: (normalized: string) => void,
): void {
  const t = e.clipboardData.getData('text');
  if (t === '') return;
  e.preventDefault();
  apply(normalizeCode(t));
}

interface SubmitDeps {
  router: { push: (path: string) => void };
  hook: GateHook;
}

// submitCodeAndGo —— calls hook.submitCode and, on success, navigates to
// `/` (carrying the home-page question ?q= along). Shared by the CodePanel
// form's onSubmit and paste auto-submit.
export async function submitCodeAndGo(
  code: string,
  name: string,
  deps: SubmitDeps,
  captchaToken = '',
): Promise<void> {
  const ok = await deps.hook.submitCode(code, name, captchaToken);
  if (ok) deps.router.push(postGateHref());
}

// postGateHref —— where to go after passing the gate.
//
// If this code is bound to a page, go to that page — **what you scanned
// into should be what you land on**, not the default chat with a
// workaround afterward. The landing decision comes down together with
// issuance and is stored by persistSession into the same session, so this
// doesn't need to ask the backend again, and it won't give a different
// answer than the name-picker path does.
//
// If it's not bound, go back to `/`; if the visitor arrived from the home
// page with a question (/gate?q=), carry the ?q= along so ChatRoom picks
// up the answer on mount (the question isn't lost).
export function postGateHref(): string {
  if (typeof window === 'undefined') {
    return '/';
  }
  const landing = codeLandingHref(loadStoredSession()?.microsite_slug ?? '');
  if (landing !== '') return landing;
  const q = new URL(window.location.href).searchParams.get('q');
  return q === null || q === '' ? '/' : `/?q=${encodeURIComponent(q)}`;
}

// scheduleAutoSubmit —— the delayed auto-submit for paste (50ms lets React
// state finish settling).
export function scheduleAutoSubmit(
  normalized: string,
  name: string,
  deps: SubmitDeps,
): void {
  if (!codeShapedForAutoSubmit(normalized)) return;
  setTimeout(() => void submitCodeAndGo(normalized, name, deps), 50);
}
