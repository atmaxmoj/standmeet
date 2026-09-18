// BlockWidget.tsx — a microsite drops a plugin (block) tool directly on the page. Clicking it runs
// that block's tool over the visitor's ADOPTED session — the same code-gated endpoint the chat agent
// uses — and renders the block's own result, with no chat and no model. What a page may run is
// exactly what the visiting code granted; a tool the code did not grant comes back refused.
//
// This is the non-chat half of "a microsite uses a plugin": AgentWidget reaches blocks THROUGH the
// LLM turn; BlockWidget/useBlockTool reach one block directly (a booking card, a corpus search, an
// ask widget) so the owner can compose plugin capabilities into their own page.

import React, { useCallback, useEffect, useState } from 'react';

import { adoptStoredSession } from '@standmeet/sdk-core';
import type { CallToolResult } from '@standmeet/sdk-core';

import { widgetClient } from './client.js';

type BlockToolState = 'idle' | 'pending' | 'done' | 'error';

// UseBlockTool — what useBlockTool returns. `granted` is false for a codeless visitor (no adopted
// session), so a page can show a gate handoff instead of a dead button.
export interface UseBlockTool {
  call: (args?: Record<string, unknown>) => Promise<void>;
  result: unknown;
  error: string | null;
  state: BlockToolState;
  granted: boolean;
}

// useBlockTool — the primitive: bind to ONE block tool over the adopted session.
export function useBlockTool(toolName: string): UseBlockTool {
  const [state, setState] = useState<BlockToolState>('idle');
  const [result, setResult] = useState<unknown>(undefined);
  const [error, setError] = useState<string | null>(null);
  // Adopt once: the session the gate stored is what authorizes the call; re-reading it on every
  // render would race a background sign-in against an in-flight call.
  const [session] = useState(() => adoptStoredSession());

  const call = useCallback(async (args?: Record<string, unknown>): Promise<void> => {
    if (session === null) {
      setError('no visitor session — open this page with an access code');
      setState('error');
      return;
    }
    setState('pending');
    setError(null);
    let out: CallToolResult;
    try {
      out = await widgetClient.callTool(
        session.conversation_id, session.session_token, toolName, args ?? {},
      );
    } catch {
      setError('the plugin could not be reached');
      setState('error');
      return;
    }
    if (out.ok) {
      setResult(out.result);
      setState('done');
    } else {
      setError(out.detail ?? out.reason ?? 'the plugin refused this request');
      setState('error');
    }
  }, [session, toolName]);

  return { call, result, error, state, granted: session !== null };
}

export interface BlockWidgetProps {
  // tool — the block tool to run (e.g. 'calendar_book', 'corpus_search', 'ask_visitor').
  tool: string;
  // args — the tool's arguments, passed through to the block unchanged.
  args?: Record<string, unknown>;
  // runLabel — the button text.
  runLabel?: string;
  // autoRun — run once on mount instead of waiting for a click (a read-only card that shows on load).
  autoRun?: boolean;
}

// BlockWidget — the drop-in: a control that runs `tool` with `args` and renders its result.
// data-state exposes ready / pending / done / error / no-session for a page (and e2e) to react to.
export function BlockWidget(
  { tool, args, runLabel = 'Run', autoRun = false }: BlockWidgetProps,
): React.ReactElement {
  const { call, result, error, state, granted } = useBlockTool(tool);
  const dataState = !granted ? 'no-session' : state === 'idle' ? 'ready' : state;

  // Fire once when granted (autoRun): a read-only card that shows its result on load. call is stable
  // (bound to the adopted session + tool), so [autoRun, granted] is the whole trigger.
  useEffect(() => {
    if (autoRun && granted) {
      void call(args);
    }
  }, [autoRun, granted, args, call]);

  return (
    <div data-testid="block-widget" data-tool={tool} data-state={dataState}>
      <button
        type="button"
        data-testid="block-widget-run"
        disabled={!granted || state === 'pending'}
        onClick={() => { void call(args); }}
      >
        {runLabel}
      </button>
      {error !== null && <div data-testid="block-widget-error">{error}</div>}
      {result !== undefined && (
        <pre data-testid="block-widget-result">
          {typeof result === 'string' ? result : JSON.stringify(result)}
        </pre>
      )}
    </div>
  );
}
