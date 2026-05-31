// /dev/agent-spike —— useAgent + agent-core 烟测路由 (dev-only)。
// 走 scripted LLMStreamer + scripted tool dispatcher + in-memory
// PromptSource + 静态 CapabilityStateSource，验证：
//   - useAgent hook 状态机正确 (messages/events/streaming flag 更新)
//   - VisitorAgent 事件流到达 UI (每个 AgentEvent 渲一行)
//   - 跟真后端解耦：纯前端就能跑
//
// e2e 抓 data-testid 验事件出现顺序。

'use client';

import { useAgent } from '@standmeet/sdk';
import {
  SPIKE_PORTS, SPIKE_SYSTEM_PARTS, SPIKE_TOOL_REGISTRY,
  eventLabel,
} from '@/app/dev/agent-spike/spike-setup';

const SEND_PROMPT = 'tell me about lucerna';

export default function AgentSpikePage(): React.ReactElement {
  const agent = useAgent({
    ports: SPIKE_PORTS,
    systemPromptPartIDs: SPIKE_SYSTEM_PARTS,
    toolSpecRegistry: SPIKE_TOOL_REGISTRY,
  });

  return (
    <main className="p-6 max-w-3xl mx-auto font-mono text-sm">
      <h1 className="text-lg mb-3">/dev/agent-spike</h1>
      <button
        data-testid="agent-spike-send"
        className="border px-3 py-1 mb-4 cursor-pointer"
        disabled={agent.streaming}
        onClick={() => { void agent.send(SEND_PROMPT); }}
      >
        {agent.streaming ? 'running…' : `send "${SEND_PROMPT}"`}
      </button>
      <section className="mb-4">
        <h2 className="text-base mb-1">events</h2>
        <ul data-testid="agent-spike-events">
          {agent.events.map((ev, i) => (
            <li key={i} data-testid={`agent-event-${ev.type}`}>
              {eventLabel(ev)}
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2 className="text-base mb-1">messages</h2>
        <ul data-testid="agent-spike-messages">
          {agent.messages.map((m, i) => (
            <li key={i} data-testid={`agent-message-${m.role}`}>
              <strong>{m.role}:</strong> {m.content}
            </li>
          ))}
        </ul>
      </section>
      {agent.error !== null && <p className="text-red-600">error: {agent.error}</p>}
    </main>
  );
}
