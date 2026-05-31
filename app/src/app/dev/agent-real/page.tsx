// /dev/agent-real —— 真后端 + 真 adapters 的 pi loop 烟测。
// 走 POST /sessions 颁发 → seed capability store → useAgent + 真 ports
// → 点 send → /inference/stream + /tools/{name} 全跑通。

'use client';

import { useEffect, useState } from 'react';
import { useAgent } from '@standmeet/sdk';
import {
  buildRealPorts, REAL_SYSTEM_PARTS, REAL_TOOL_REGISTRY, seedCapabilityStore,
} from '@/app/dev/agent-real/real-setup';
import { toolStartedNames, lastAssistantContent } from '@/app/dev/agent-multi-iter/multi-iter-setup';
import { issueSessionForRealRoute } from '@/app/dev/agent-real/issue-real-session';
import type { RealSessionInfo } from '@/app/dev/agent-real/issue-real-session';

const SEND_PROMPT = 'tell me about lucerna';

interface PortBundle extends RealSessionInfo {
  ports: ReturnType<typeof buildRealPorts>;
}

function useRealBundle(code: string): PortBundle | null {
  const [bundle, setBundle] = useState<PortBundle | null>(null);
  useEffect(() => {
    const guard = { cancelled: false };
    void issueSessionForRealRoute(code).then(
      (info) => guard.cancelled ? undefined : applyBundle(info, setBundle),
    );
    return () => { guard.cancelled = true; };
  }, [code]);
  return bundle;
}

function applyBundle(
  info: RealSessionInfo, setBundle: (b: PortBundle) => void,
): void {
  seedCapabilityStore(info.capabilities);
  setBundle({
    ...info,
    ports: buildRealPorts({
      sessionToken: info.sessionToken, conversationID: info.conversationID,
    }),
  });
}

interface InnerProps { bundle: PortBundle }

function AgentReal({ bundle }: InnerProps): React.ReactElement {
  const agent = useAgent({
    ports: bundle.ports,
    systemPromptPartIDs: REAL_SYSTEM_PARTS,
    toolSpecRegistry: REAL_TOOL_REGISTRY,
  });
  const throbbers = toolStartedNames(agent.events);
  const finalText = lastAssistantContent(agent.messages);
  return (
    <main className="p-6 max-w-3xl mx-auto font-mono text-sm">
      <h1 className="text-lg mb-3">/dev/agent-real</h1>
      <button
        data-testid="real-send"
        className="border px-3 py-1 mb-4 cursor-pointer"
        disabled={agent.streaming}
        onClick={() => { void agent.send(SEND_PROMPT); }}
      >
        {agent.streaming ? 'running…' : `send "${SEND_PROMPT}"`}
      </button>
      <section className="mb-4">
        <h2 className="text-base mb-1">tool throbbers</h2>
        <ol data-testid="real-throbbers">
          {throbbers.map((name, i) => (
            <li key={i} data-testid={`real-throbber-${i}`}>{name}</li>
          ))}
        </ol>
      </section>
      <section>
        <h2 className="text-base mb-1">final assistant message</h2>
        <div data-testid="real-final-text">{finalText}</div>
      </section>
    </main>
  );
}

export default function AgentRealPage(): React.ReactElement {
  const code = useCodeFromHash();
  const bundle = useRealBundle(code);
  return bundle === null
    ? <main className="p-6 font-mono text-sm">issuing session...</main>
    : <AgentReal bundle={bundle} />;
}

function useCodeFromHash(): string {
  const [code, setCode] = useState<string>('');
  useEffect(() => {
    setCode(window.location.hash.replace(/^#/, '') || 'REAL-001');
  }, []);
  return code;
}
