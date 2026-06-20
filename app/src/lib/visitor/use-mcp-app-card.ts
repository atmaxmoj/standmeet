// use-mcp-app-card —— Phase F: 沙盒 ui:// 卡片的 postMessage 协议（business logic，
// 放 lib，组件只拿 ref/height 渲染）。
//   卡 ready → 父注入 {type:'mcp-ui:data', data:<tool result>}
//   卡 submit → onAsk(value)（访客选择进下一 turn）
//   卡 height → 自适应高度

import { useEffect, useRef, useState } from 'react';

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
  onAsk: (q: string) => void;
  setHeight: (h: number) => void;
}

const HANDLERS: Record<string, (c: Ctx) => void> = {
  'mcp-ui:ready': ({ win, result }) =>
    { win.postMessage({ type: 'mcp-ui:data', data: parseResult(result) }, '*'); },
  'mcp-ui:submit': ({ data, onAsk }) =>
    { typeof data['value'] === 'string' && onAsk(data['value']); },
  'mcp-ui:height': ({ data, setHeight }) => {
    const h = clampHeight(data['height']);
    h !== null && setHeight(h);
  },
};

function dispatch(c: Ctx): void {
  const type = typeof c.data['type'] === 'string' ? c.data['type'] : '';
  HANDLERS[type]?.(c);
}

export function useMcpAppCard(result: unknown, onAsk: (q: string) => void) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  useEffect(() => {
    function onMsg(e: MessageEvent): void {
      const win = ref.current?.contentWindow ?? null;
      const ok = win !== null && e.source === win && isRecord(e.data);
      ok && dispatch({ win, data: e.data, result, onAsk, setHeight });
    }
    window.addEventListener('message', onMsg);
    return () => { window.removeEventListener('message', onMsg); };
  }, [result, onAsk]);
  return { ref, height };
}
