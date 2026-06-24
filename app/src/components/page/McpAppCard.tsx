// McpAppCard —— Phase F: 沙盒渲染一个外置 MCP app 能力自带的 ui:// 卡片。
//
// 外置能力（如 ask_visitor）的 server 自己 serve 一张 ui:// HTML 卡（装配期被读进
// CapabilityState.extra.ui.html）。这里把它塞进 sandbox iframe（allow-scripts，无
// same-origin → 拿不到父页 cookie/DOM），协议在 use-mcp-app-card。能力自带渲染 =
// 真正自包含，替代写死的 AskVisitorCard。

'use client';

import { useMcpAppCard } from '@/lib/visitor/use-mcp-app-card';
import type { ToolCallView } from '@/lib/page/use-chat';

interface Props {
  call: ToolCallView;
  html: string;
  // onAsk —— 仅交互卡(ask_visitor / slots)需要把访客选择 forward 进下一 turn；
  // 只读卡(corpus hits / report)不 submit，省略即可，submit 走 no-op。
  onAsk?: (q: string) => void;
}

const NOOP = (): void => {};

export function McpAppCard({ call, html, onAsk }: Props) {
  const { ref, height } = useMcpAppCard(call.result, onAsk ?? NOOP, call.name);
  return (
    <iframe
      ref={ref}
      data-testid={`mcp-app-card-${call.name}`}
      title={`${call.name} card`}
      sandbox="allow-scripts"
      srcDoc={html}
      // eslint-disable-next-line no-restricted-syntax -- height is runtime-dynamic (posted by the sandboxed card)
      style={{ width: '100%', height, border: 'none', display: 'block' }}
    />
  );
}
