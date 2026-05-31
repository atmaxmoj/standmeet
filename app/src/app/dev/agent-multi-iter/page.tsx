// /dev/agent-multi-iter —— 3-iteration scenario：search → read → final。
// 验 per-iter throbber 渲对 + 顺序正确。

'use client';

import { useAgent } from '@standmeet/sdk';
import {
  MULTI_PORTS, MULTI_SYSTEM_PARTS, MULTI_TOOL_REGISTRY,
  toolStartedNames, lastAssistantContent,
} from '@/app/dev/agent-multi-iter/multi-iter-setup';

const SEND_PROMPT = 'walk me through lucerna';

export default function MultiIterPage(): React.ReactElement {
  const agent = useAgent({
    ports: MULTI_PORTS,
    systemPromptPartIDs: MULTI_SYSTEM_PARTS,
    toolSpecRegistry: MULTI_TOOL_REGISTRY,
  });
  const throbbers = toolStartedNames(agent.events);
  const finalText = lastAssistantContent(agent.messages);

  return (
    <main className="p-6 max-w-3xl mx-auto font-mono text-sm">
      <h1 className="text-lg mb-3">/dev/agent-multi-iter</h1>
      <button
        data-testid="multi-iter-send"
        className="border px-3 py-1 mb-4 cursor-pointer"
        disabled={agent.streaming}
        onClick={() => { void agent.send(SEND_PROMPT); }}
      >
        {agent.streaming ? 'running…' : `send "${SEND_PROMPT}"`}
      </button>
      <section className="mb-4">
        <h2 className="text-base mb-1">tool throbbers (in order)</h2>
        <ol data-testid="multi-iter-throbbers">
          {throbbers.map((name, i) => (
            <li key={i} data-testid={`throbber-${i}`}>{name}</li>
          ))}
        </ol>
      </section>
      <section>
        <h2 className="text-base mb-1">final assistant message</h2>
        <div data-testid="multi-iter-final-text">{finalText}</div>
      </section>
    </main>
  );
}
