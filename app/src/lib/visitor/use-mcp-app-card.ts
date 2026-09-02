// use-mcp-app-card —— Phase F: the postMessage protocol for a sandboxed
// ui:// card (business logic lives in lib; the component only takes
// ref/height to render).
//   card ready → parent injects {type:'mcp-ui:data', data:<tool result>}
//   card submit → onAsk(value) (the visitor's choice feeds the next turn)
//   card tool  → the host dispatches the named tool with session context,
//                posts the result back to the card (mcp-ui:tool-result)
//   card height → self-sizing height

import { useEffect, useRef, useState } from 'react';

import { callVisitorTool } from '@/lib/api/public';
import { getAppCardState, setAppCardState } from '@/lib/api/app-state';
import { loadStoredSession } from '@/lib/gate/use-gate';

const DEFAULT_HEIGHT = 120;
const MIN_HEIGHT = 40;
const MAX_HEIGHT = 600;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function parseResult(result: unknown): unknown {
  if (typeof result !== 'string') return result;
  try {
    return JSON.parse(result);
  } catch {
    return {};
  }
}

function clampHeight(h: unknown): number | null {
  if (typeof h !== 'number') return null;
  return Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, h));
}

interface Ctx {
  win: Window;
  data: Record<string, unknown>;
  result: unknown;
  tool: string;
  conversationID: string;
  onAsk: (q: string) => void;
  // noteEvent —— writes what happened on the card into this conversation's
  // history (F-B-9). See runCardTool.
  noteEvent: (text: string) => void;
  setHeight: (h: number) => void;
}

const HANDLERS: Record<string, (c: Ctx) => void> = {
  // ready → the parent injects {data:<tool result>, tool, state:<this
  // card's cross-refresh state>}. The tool name lets one card serve
  // several same-shape tools (corpus_search/corpus_list) and pick its own
  // label/testid. state lets the card act as a "small app that survives a
  // refresh", rendering the state it left off in (a booked card reads
  // state[event_id].cancelled).
  'mcp-ui:ready': (c) => { void runCardReady(c); },
  'mcp-ui:submit': ({ data, onAsk }) =>
    { typeof data['value'] === 'string' && onAsk(data['value']); },
  // tool → the card sends a named tool (calendar_cancel /
  // send_confirmation), the host dispatches it with the visitor's session,
  // and posts the result back to the card. A sandboxed card has no network
  // — every connector call goes through the host (credentials never enter
  // the card).
  'mcp-ui:tool': (c) => { void runCardTool(c); },
  // state-set → the card writes a key into **its own mcp slot** (mcp is
  // derived by the host from session + tool, so a card can't touch another
  // mcp's slot). A booked card writes {event_id:{cancelled:true}} after a
  // successful cancel, and re-renders from it after a refresh.
  'mcp-ui:state-set': (c) => { void runCardStateSet(c); },
  // link → the card asks its parent to open a URL (the sandboxed iframe
  // has no allow-popups/top-navigation, so opening a window can only be
  // done by the parent). href comes from a plugin card (trusted — see
  // trust boundary P.4); used by report's "open as page".
  'mcp-ui:link': ({ data }) => { openLink(data['href']); },
  'mcp-ui:height': ({ data, setHeight }) => {
    const h = clampHeight(data['height']);
    h !== null && setHeight(h);
  },
};

function openLink(href: unknown): void {
  if (typeof href === 'string' && href !== '') {
    window.open(href, '_blank', 'noopener,noreferrer');
  }
}

// runCardTool —— dispatches the named tool the card sent, posts the result
// (with a requestId receipt) back to the card, **and records the event
// into this conversation's history** (F-B-9).
//
// This path doesn't go through the conversation: `POST
// /sessions/{id}/tools/{name}` returns once it executes. Without that last
// step, a booking the visitor cancelled on the card never happened as far
// as the agent is concerned — its next reply would still say "your booking
// still stands", right under the same-screen card that reads `CANCELLED`.
async function runCardTool(c: Ctx): Promise<void> {
  const name = typeof c.data['name'] === 'string' ? c.data['name'] : '';
  const requestId = c.data['requestId'];
  const args = isRecord(c.data['args']) ? c.data['args'] : {};
  const token = loadStoredSession()?.session_token ?? '';
  const result = await callVisitorTool(c.conversationID, token, name, args);
  c.noteEvent(cardEventText(name, result));
  c.win.postMessage({ type: 'mcp-ui:tool-result', requestId, result }, '*');
}

// cardEventText —— a sentence for the model to read. **Includes the tool
// name and the raw result**: the model composes its own wording, but it
// needs to judge "did this actually succeed, and which one did it touch",
// so the facts are given as-is instead of being summarized here.
function cardEventText(name: string, result: Record<string, unknown>): string {
  if (name === '') return '';
  return `[card action] The visitor used "${name}" on a card in this conversation. `
    + `Result: ${JSON.stringify(result)}`;
}

// runCardReady —— when the card is ready, pulls this card's cross-refresh
// state and injects it into mcp-ui:data together with the tool result.
async function runCardReady(c: Ctx): Promise<void> {
  const token = loadStoredSession()?.session_token ?? '';
  const state = await getAppCardState(c.conversationID, token, c.tool);
  c.win.postMessage(
    { type: 'mcp-ui:data', data: parseResult(c.result), tool: c.tool, state }, '*',
  );
}

// runCardStateSet —— the card writes a key into its own mcp slot (mcp is
// derived by the host from the tool, keeping cards isolated). Replies with
// an ack (carrying requestId) once written, so the card only reaches its
// final state **after the write is actually persisted** — otherwise
// "showing cancelled" would precede persistence, and an immediate refresh
// would read the stale state back (a race).
async function runCardStateSet(c: Ctx): Promise<void> {
  const key = typeof c.data['key'] === 'string' ? c.data['key'] : '';
  const requestId = c.data['requestId'];
  const token = loadStoredSession()?.session_token ?? '';
  await setAppCardState(c.conversationID, token, c.tool, key, c.data['value']);
  c.win.postMessage({ type: 'mcp-ui:state-ack', requestId }, '*');
}

function dispatch(c: Ctx): void {
  const type = typeof c.data['type'] === 'string' ? c.data['type'] : '';
  HANDLERS[type]?.(c);
}

const NOOP = (): void => undefined;

/** CardWiring —— the four wires a card needs hooked up. **Defaults live
 *  here**: the component calling this just forwards them — if each
 *  optional prop got its own `??` fallback over there, the cyclomatic
 *  complexity gate would (rightly) catch up with that component eventually. */
export interface CardWiring {
  result: unknown;
  tool: string;
  onAsk?: (q: string) => void;
  conversationID?: string;
  noteEvent?: (text: string) => void;
}

export function useMcpAppCard(w: CardWiring) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const { result, tool } = w;
  const onAsk = w.onAsk ?? NOOP;
  const conversationID = w.conversationID ?? '';
  const noteEvent = w.noteEvent ?? NOOP;
  useEffect(() => {
    function onMsg(e: MessageEvent): void {
      const win = ref.current?.contentWindow ?? null;
      const ok = win !== null && e.source === win && isRecord(e.data);
      ok && dispatch({
        win, data: e.data, result, tool, conversationID, onAsk, noteEvent, setHeight,
      });
    }
    window.addEventListener('message', onMsg);
    return () => { window.removeEventListener('message', onMsg); };
  }, [result, onAsk, tool, conversationID, noteEvent]);
  return { ref, height };
}
