// McpAppCard —— the embedded agent's host for a tool's own ui:// card (ask_visitor's question),
// the same cards the main chat renders (app/src/components/page/McpAppCard.tsx). The html is
// dropped into a sandboxed iframe (allow-scripts, no same-origin → no cookies/DOM of the page);
// the card speaks the mcp-ui postMessage protocol:
//   card ready  → host injects {type:'mcp-ui:data', data:<tool result>, tool, state}
//   card submit → onAsk(value): the visitor's choice is sent as their next message
//   card height → self-sizing
//   card link   → host opens the url (the sandbox has no popups)
// ponytail: mcp-ui:tool and mcp-ui:state-set (booking cards: dispatch a tool / survive a refresh)
// are not wired here yet; cards that need them wait for the main-chat host to move into the SDK.

import React, { useEffect, useRef, useState } from 'react';
import { pageCardTheme } from '@standmeet/sdk-core';

import type { ChatCard } from '../use-chat-session.js';

const DEFAULT_HEIGHT = 120;
const MIN_HEIGHT = 40;
const MAX_HEIGHT = 600;

export function McpAppCard(
  { card, onAsk }: { readonly card: ChatCard; readonly onAsk: (q: string) => void },
): React.ReactElement {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  useEffect(() => {
    function onMsg(e: MessageEvent): void {
      const win = ref.current?.contentWindow ?? null;
      if (win === null || e.source !== win || !isRecord(e.data)) return;
      handle(e.data, { win, card, onAsk, setHeight });
    }
    window.addEventListener('message', onMsg);
    return () => { window.removeEventListener('message', onMsg); };
  }, [card, onAsk]);
  return (
    <iframe
      ref={ref}
      data-testid={`mcp-app-card-${card.tool}`}
      title={`${card.tool} card`}
      sandbox="allow-scripts"
      srcDoc={card.html}
      style={{ width: '100%', height, border: 'none', display: 'block' }}
    />
  );
}

interface Ctx {
  win: Window;
  card: ChatCard;
  onAsk: (q: string) => void;
  setHeight: (h: number) => void;
}

const HANDLERS: Record<string, (d: Record<string, unknown>, c: Ctx) => void> = {
  'mcp-ui:ready': (_, c) => {
    c.win.postMessage({
      type: 'mcp-ui:data', data: parseResult(c.card.result), tool: c.card.tool, state: {},
      theme: pageCardTheme(), // the page's tokens, so the card matches light/dark
    }, '*');
  },
  'mcp-ui:submit': (d, c) => { if (typeof d['value'] === 'string') c.onAsk(d['value']); },
  'mcp-ui:height': (d, c) => {
    const h = d['height'];
    if (typeof h === 'number') c.setHeight(Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, h)));
  },
  'mcp-ui:link': (d) => {
    const href = d['href'];
    if (typeof href === 'string' && href !== '') window.open(href, '_blank', 'noopener,noreferrer');
  },
};

function handle(d: Record<string, unknown>, c: Ctx): void {
  const type = typeof d['type'] === 'string' ? d['type'] : '';
  HANDLERS[type]?.(d, c);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function parseResult(result: string): unknown {
  try {
    return JSON.parse(result);
  } catch {
    return {};
  }
}
