// /dev/agent-resync —— capability state cascade demo。
// burn 后 LLM 看不见 calendar_book，下一轮 fallback 到 corpus_search。

'use client';

import { useState } from 'react';
import { useAgent } from '@standmeet/sdk';
import {
  RESYNC_SYSTEM_PARTS, RESYNC_TOOL_REGISTRY, makeResyncPorts,
} from '@/app/dev/agent-resync/resync-setup';
import { toolStartedNames, lastAssistantContent } from '@/app/dev/agent-multi-iter/multi-iter-setup';

const SEND_PROMPT = 'book a meeting and pull context';

export default function ResyncPage(): React.ReactElement {
  const [bundle] = useState(() => makeResyncPorts());
  const agent = useAgent({
    ports: bundle.ports,
    systemPromptPartIDs: RESYNC_SYSTEM_PARTS,
    toolSpecRegistry: RESYNC_TOOL_REGISTRY,
  });
  const throbbers = toolStartedNames(agent.events);
  const finalText = lastAssistantContent(agent.messages);
  const caps = bundle.capSource.current();
  const calendarVisible = caps.some(c => c.id === 'calendar.book');

  return (
    <main className="p-6 max-w-3xl mx-auto font-mono text-sm">
      <h1 className="text-lg mb-3">/dev/agent-resync</h1>
      <button
        data-testid="resync-send"
        className="border px-3 py-1 mb-4 cursor-pointer"
        disabled={agent.streaming}
        onClick={() => { void agent.send(SEND_PROMPT); }}
      >
        {agent.streaming ? 'running…' : `send "${SEND_PROMPT}"`}
      </button>
      <section className="mb-4">
        <h2 className="text-base mb-1">tool throbbers</h2>
        <ol data-testid="resync-throbbers">
          {throbbers.map((name, i) => (
            <li key={i} data-testid={`resync-throbber-${i}`}>{name}</li>
          ))}
        </ol>
      </section>
      <section className="mb-4">
        <h2 className="text-base mb-1">capability state (current)</h2>
        <p data-testid="resync-calendar-visible">
          calendar.book visible: {calendarVisible ? 'yes' : 'no'}
        </p>
      </section>
      <section>
        <h2 className="text-base mb-1">final assistant message</h2>
        <div data-testid="resync-final-text">{finalText}</div>
      </section>
    </main>
  );
}
