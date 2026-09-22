// BlockWidget.tsx — a microsite drops a plugin (block) tool directly on the page. Clicking it runs
// that block's tool over the visitor's ADOPTED session — the same code-gated endpoint the chat agent
// uses — and renders the block's own result, with no chat and no model. What a page may run is
// exactly what the visiting code granted; a tool the code did not grant comes back refused.
//
// This is the non-chat half of "a microsite uses a plugin": AgentWidget reaches blocks THROUGH the
// LLM turn; BlockWidget/useBlockTool reach one block directly (a booking card, a corpus search, an
// ask widget) so the owner can compose plugin capabilities into their own page.

import React, { useCallback, useEffect, useRef, useState } from 'react';

import { adoptStoredSession, publicSearchEnabled } from '@standmeet/sdk-core';
import type { CallToolResult } from '@standmeet/sdk-core';

import { widgetClient } from './client.js';

type BlockToolState = 'idle' | 'pending' | 'done' | 'error';

// A minimal session the widget runs a tool over: either the code's adopted session, or a codeless
// public one it opened itself when public_search is on.
interface RunSession { conversation_id: string; session_token: string }

// PUBLIC_SAFE_TOOLS —— the read-only corpus tools a codeless (anonymous) visitor may run when the
// owner turned public_search on. They all read the PUBLISHED-only slice (a public session's scope),
// so opening a session for them leaks nothing. A write/booking tool is never on this list: it has
// no meaning without a code's grant, and this widget must not manufacture one.
const PUBLIC_SAFE_TOOLS = new Set<string>([
  'corpus_search', 'corpus_read', 'corpus_list', 'corpus_links',
  'corpus_map', 'corpus_resolve', 'corpus_peek', 'corpus_grep',
]);

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
  // publicEligible —— no code arrived, but the owner opened public_search AND this is a read-only
  // corpus tool. Then the widget may open a codeless public session of its own (published-only
  // scope) instead of refusing. Decided once, off the render path, same as `session`.
  const [publicEligible] = useState(
    () => session === null && publicSearchEnabled() && PUBLIC_SAFE_TOOLS.has(toolName),
  );
  // The codeless public session, opened lazily on first run and reused: opening it per click would
  // start a fresh conversation each time and hit the /sessions per-IP cap for nothing.
  const publicSession = useRef<RunSession | null>(null);

  // resolveSession —— the session to run this tool over: the adopted one, else (public-eligible) a
  // codeless public session opened on demand. null = neither is available (caller shows the gate).
  const resolveSession = useCallback(async (): Promise<RunSession | null> => {
    if (session !== null) return session;
    if (!publicEligible) return null;
    if (publicSession.current === null) {
      const issued = await widgetClient.issueSession({ mode: 'public' });
      publicSession.current = {
        conversation_id: issued.conversation_id, session_token: issued.session_token,
      };
    }
    return publicSession.current;
  }, [session, publicEligible]);

  const call = useCallback(async (args?: Record<string, unknown>): Promise<void> => {
    setState('pending');
    setError(null);
    let active: RunSession | null;
    try {
      active = await resolveSession();
    } catch {
      setError('the plugin could not be reached');
      setState('error');
      return;
    }
    if (active === null) {
      setError('no visitor session — open this page with an access code');
      setState('error');
      return;
    }
    let out: CallToolResult;
    try {
      out = await widgetClient.callTool(
        active.conversation_id, active.session_token, toolName, args ?? {},
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
  }, [resolveSession, toolName]);

  return { call, result, error, state, granted: session !== null || publicEligible };
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

  // No session → say so, in words. The disabled run button alone leaves a visitor staring at a
  // dead control: the "open with a code" line used to live only inside call(), which the disabled
  // button can never fire, so it never showed. Render it here instead, off the click path.
  if (!granted) {
    return (
      <div data-testid="block-widget" data-tool={tool} data-state={dataState}>
        <p data-testid="block-widget-no-session">
          Open this page with an access code to use this.
        </p>
      </div>
    );
  }

  return (
    <div data-testid="block-widget" data-tool={tool} data-state={dataState}>
      <button
        type="button"
        data-testid="block-widget-run"
        disabled={state === 'pending'}
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
