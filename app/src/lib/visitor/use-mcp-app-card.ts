// use-mcp-app-card —— Phase F: 沙盒 ui:// 卡片的 postMessage 协议（business logic，
// 放 lib，组件只拿 ref/height 渲染）。
//   卡 ready → 父注入 {type:'mcp-ui:data', data:<tool result>}
//   卡 submit → onAsk(value)（访客选择进下一 turn）
//   卡 tool  → host 带 session context 派发具名 tool，结果 post 回卡（mcp-ui:tool-result）
//   卡 height → 自适应高度

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
  setHeight: (h: number) => void;
}

const HANDLERS: Record<string, (c: Ctx) => void> = {
  // ready → 父注入 {data:<tool result>, tool, state:<本卡跨刷新状态>}。tool 名让一张
  // 卡服务多个同形工具(corpus_search/corpus_list)时自挑 label/testid。state 让卡作为
  // 「能跨刷新存活的小应用」render 出上次落下的态（booked 卡读 state[event_id].cancelled）。
  'mcp-ui:ready': (c) => { void runCardReady(c); },
  'mcp-ui:submit': ({ data, onAsk }) =>
    { typeof data['value'] === 'string' && onAsk(data['value']); },
  // tool → 卡发具名 tool（calendar_cancel / send_confirmation），host 凭访客 session
  // 派发，结果 post 回卡。沙盒卡断网，连接器调用全经 host（凭据不进卡）。
  'mcp-ui:tool': (c) => { void runCardTool(c); },
  // state-set → 卡对**自己 mcp 那格**写一个 key（host 凭 session + tool 派生 mcp，卡碰
  // 不到别的 mcp）。booked 卡取消成功后落 {event_id:{cancelled:true}}，刷新后据此重渲。
  'mcp-ui:state-set': (c) => { void runCardStateSet(c); },
  // link → 卡请求父开一个 URL（沙盒 iframe 无 allow-popups/top-navigation，开窗只能
  // 父代劳）。href 来自插件卡(可信，见信任边界 P.4)；report「open as page」用。
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

// runCardTool —— 派发卡发来的具名 tool，结果（含 requestId 回执）post 回卡。
async function runCardTool(c: Ctx): Promise<void> {
  const name = typeof c.data['name'] === 'string' ? c.data['name'] : '';
  const requestId = c.data['requestId'];
  const args = isRecord(c.data['args']) ? c.data['args'] : {};
  const token = loadStoredSession()?.session_token ?? '';
  const result = await callVisitorTool(c.conversationID, token, name, args);
  c.win.postMessage({ type: 'mcp-ui:tool-result', requestId, result }, '*');
}

// runCardReady —— 卡 ready 时拉本卡跨刷新状态，连同 tool result 一起注入 mcp-ui:data。
async function runCardReady(c: Ctx): Promise<void> {
  const token = loadStoredSession()?.session_token ?? '';
  const state = await getAppCardState(c.conversationID, token, c.tool);
  c.win.postMessage(
    { type: 'mcp-ui:data', data: parseResult(c.result), tool: c.tool, state }, '*',
  );
}

// runCardStateSet —— 卡对自己 mcp 那格写一个 key（mcp 由 host 从 tool 派生，隔离）。
// 写完回 ack（带 requestId），让卡在状态**真落库后**再进终态 —— 否则「显示已取消」
// 早于持久化，紧接着刷新会读到旧态（race）。
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

export function useMcpAppCard(
  result: unknown, onAsk: (q: string) => void, tool: string, conversationID = '',
) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  useEffect(() => {
    function onMsg(e: MessageEvent): void {
      const win = ref.current?.contentWindow ?? null;
      const ok = win !== null && e.source === win && isRecord(e.data);
      ok && dispatch({ win, data: e.data, result, tool, conversationID, onAsk, setHeight });
    }
    window.addEventListener('message', onMsg);
    return () => { window.removeEventListener('message', onMsg); };
  }, [result, onAsk, tool, conversationID]);
  return { ref, height };
}
