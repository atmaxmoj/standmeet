// use-agent.ts —— React hook 包 @standmeet/agent-core 的 VisitorAgent。
//
// caller 负责：
//   - 注 5 个 port (prompts / capabilities / llm / tools / observer)
//   - 注 toolSpecRegistry 和 systemPromptPartIDs (从 session 颁发响应
//     拿到)
// hook 负责：
//   - 把 agent 的 event 流落到 React state (messages / streaming /
//     events tail)
//   - 暴露 send(text) 给 UI
//
// hook 自己保留一个 EventObserver 包住 caller 传进的 observer (caller
// observer 可选)，确保 hook 内部 state 与 caller observer 都收到事件。

import { useCallback, useMemo, useRef, useState } from 'react';
import {
  VisitorAgent,
  type AgentEvent,
  type EventObserver,
  type Message,
  type ToolSpecRegistry,
  type VisitorAgentPorts,
} from '@standmeet/agent-core';

export interface UseAgentOptions {
  readonly ports: Omit<VisitorAgentPorts, 'observer'> & { readonly observer?: EventObserver };
  readonly systemPromptPartIDs: readonly string[];
  readonly toolSpecRegistry: ToolSpecRegistry;
  readonly maxIterations?: number;
}

export interface AgentState {
  readonly messages: readonly Message[];
  readonly events: readonly AgentEvent[];
  readonly streaming: boolean;
  readonly error: string | null;
  readonly send: (userMessage: string) => Promise<void>;
}

export function useAgent(opts: UseAgentOptions): AgentState {
  const [messages, setMessages] = useState<readonly Message[]>([]);
  const [events, setEvents] = useState<readonly AgentEvent[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // observer wrapper —— 把 agent event 落到 React state，再转给 caller
  // 注的 observer (如果有)。caller observer 用 ref 锁，避免 useAgent 每
  // 次 re-render 都重建 VisitorAgent。
  const callerObserverRef = useRef<EventObserver | undefined>(opts.ports.observer);
  callerObserverRef.current = opts.ports.observer;

  const observer: EventObserver = useMemo(() => ({
    onEvent(event: AgentEvent): void {
      setEvents((prev) => [...prev, event]);
      callerObserverRef.current?.onEvent(event);
    },
  }), []);

  const agent = useMemo(() => new VisitorAgent(
    { ...opts.ports, observer },
    {
      systemPromptPartIDs: opts.systemPromptPartIDs,
      toolSpecRegistry: opts.toolSpecRegistry,
      maxIterations: opts.maxIterations,
    },
  ), [opts.ports, opts.systemPromptPartIDs, opts.toolSpecRegistry, opts.maxIterations, observer]);

  const send = useCallback(async (userMessage: string): Promise<void> => {
    setError(null);
    setStreaming(true);
    try {
      const next = await agent.send({ userMessage, history: messages });
      setMessages(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStreaming(false);
    }
  }, [agent, messages]);

  return { messages, events, streaming, error, send };
}
