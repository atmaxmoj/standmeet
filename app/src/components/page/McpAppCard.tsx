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
  // conversationID —— booked 卡的 mcp-ui:tool 派发(cancel / send_confirmation)凭它 +
  // 访客 session 调 tool；不发 tool 的卡省略即可。
  conversationID?: string;
  // noteEvent —— 卡上派出去的工具调用要进这段对话的历史，否则 agent 下一轮不知道
  // 访客刚把那场会取消了（F-B-9）。
  noteEvent?: (text: string) => void;
}

// 这个组件只把 props 转给 hook —— 缺省值住在 hook 那边（`CardWiring`）。
// 在这儿补 `??` 的话，每加一个可选 prop 就多一处分支，闸门会（正当地）拦住它。
export function McpAppCard({ call, html, onAsk, conversationID, noteEvent }: Props) {
  const { ref, height } = useMcpAppCard({
    result: call.result, tool: call.name, onAsk, conversationID, noteEvent,
  });
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
