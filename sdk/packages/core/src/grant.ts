// grant.ts —— **the grant the visitor already holds**, and what a custom
// page should give them based on it.
//
// A code can be bound to a custom page: scanning it lands on that page
// instead of the default chat. Given that, the agent on that page **must be
// this code's agent** —— the same grant, the same role, the same quota, the
// same accounting. The approach isn't to make every page author go fish
// `?code=` off the URL themselves (they'd get it, then forget, then silently
// fall back to anonymous with no visible difference on screen) —— instead,
// the moment the session was issued, the browser already stored it, and the
// page **adopts** it directly. The page author does nothing, and there's no
// room to get it wrong.
//
// Where it lives: `standmeet:visitor-session`, written by the instance's own
// gate at issue time. Same-origin, so `/p/<slug>` can read it. This key name
// is **part of the protocol** —— both sides must use the same string, so it's
// defined here and the app side references it.

const SESSION_KEY = 'standmeet:visitor-session';

/** VISITOR_SESSION_STORAGE_KEY —— where an issued session lands. The writing side uses this same constant. */
export const VISITOR_SESSION_STORAGE_KEY = SESSION_KEY;

// AdoptedSession —— everything needed to adopt an existing session: where to
// send (conversation), what to authenticate with (token), and how to compose
// this session's system prompt.
export interface AdoptedSession {
  readonly conversation_id: string;
  readonly session_token: string;
  readonly system_prompt_part_ids?: readonly string[];
  readonly system_prompt_persona?: string;
}

// adoptStoredSession —— is there an already-issued session in the browser?
// Missing / unreadable / wrong shape → null, and the caller opens its own
// session as usual.
//
// Does nothing beyond validation: adding a "helpfully fill in a default"
// layer here would mean deciding admission on the owner's behalf
// ([[invented-default-grants-privilege]]).
export function adoptStoredSession(): AdoptedSession | null {
  const raw = readRaw();
  if (raw === null) return null;
  const conversation = stringField(raw, 'conversation_id');
  const token = stringField(raw, 'session_token');
  if (conversation === '' || token === '') return null;
  return {
    conversation_id: conversation,
    session_token: token,
    system_prompt_part_ids: stringArrayField(raw, 'system_prompt_part_ids'),
    system_prompt_persona: stringField(raw, 'system_prompt_persona'),
  };
}

// hasVisitorGrant —— did this reader arrive with a grant already? **The
// page's own settings only count when nobody arrived with a grant**: with a
// code attached, admission runs entirely through the code; this check is the
// sole place that rule lands.
export function hasVisitorGrant(): boolean {
  return adoptStoredSession() !== null;
}

// AdoptedDockButton —— one of the code's configured chat dock buttons, as stored in the session
// blob the gate wrote. Shape mirrors the backend PublicSessionDockButton.
export interface AdoptedDockButton {
  readonly capability_id: string;
  readonly title: string;
  readonly trigger: string;
}

// adoptedDockButtons —— the dock buttons the code granted, read straight from the stored session
// blob (the gate wrote them at issue time). This is **structural inheritance**, not a per-button
// decision: the embedded agent renders whatever the code configured, so a new dock button the
// owner adds to the role shows up here with no widget change. Missing / wrong shape → [].
export function adoptedDockButtons(): readonly AdoptedDockButton[] {
  const raw = readRaw();
  if (raw === null) return [];
  const list = raw['dock_buttons'];
  if (!Array.isArray(list)) return [];
  return list.filter(isDockButton);
}

function isDockButton(x: unknown): x is AdoptedDockButton {
  if (typeof x !== 'object' || x === null) return false;
  const r = x as Record<string, unknown>;
  return typeof r['capability_id'] === 'string'
    && typeof r['title'] === 'string'
    && typeof r['trigger'] === 'string';
}

// pageAllowsBYOAI —— does this page allow the reader to bring their own key?
//
// The value comes from the meta tag injected into index.html **when this
// request was served** (see backend custom_pages.go): if the page is taken
// down or the setting changes, the next request gets the new value —— the
// page keeps no snapshot, and there's no second endpoint to ask.
export function pageAllowsBYOAI(): boolean {
  if (typeof document === 'undefined') return false;
  const el = document.querySelector('meta[name="standmeet-page-byoai"]');
  return el?.getAttribute('content') === 'true';
}

// byoaiOffered —— should this page offer the reader the "bring your own key"
// path? Someone who arrived with a grant shouldn't be asked —— what they
// hold outranks a bring-your-own key, and it came from the owner.
export function byoaiOffered(): boolean {
  return !hasVisitorGrant() && pageAllowsBYOAI();
}

function readRaw(): Record<string, unknown> | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function stringField(raw: Record<string, unknown>, key: string): string {
  const v = raw[key];
  return typeof v === 'string' ? v : '';
}

function stringArrayField(
  raw: Record<string, unknown>, key: string,
): readonly string[] | undefined {
  const v = raw[key];
  if (!Array.isArray(v)) return undefined;
  return v.filter((x): x is string => typeof x === 'string');
}
