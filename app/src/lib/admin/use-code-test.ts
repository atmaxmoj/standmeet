// use-code-test —— the "try it" button in admin /admin/codes's
// VisitorPreviewModal. Lets the owner personally run a code session without
// opening a private browser window:
//   - opens a session (visitor_name = "(owner test)", so it's told apart at a
//     glance from real visitors in the conversations list by visitor_name)
//   - sends a message, subscribes to the SSE stream, appends token / done into reply

import { useCallback, useRef, useState } from 'react';

import {
  issueCodeSession,
  streamChatMessage, composeChatSystem,
  type PublicSessionResponse,
} from '@/lib/api/public';
import { logger } from '@/lib/logger';

export const OWNER_TEST_VISITOR_NAME = '(owner test)';

export type Phase = 'idle' | 'opening' | 'ready' | 'streaming' | 'done' | 'error';

export interface CodeTestState {
  phase: Phase;
  hasSession: boolean;
  reply: string;
  error: string | null;
}

export interface CodeTestHook {
  state: CodeTestState;
  start: (code: string) => Promise<void>;
  send: (text: string) => Promise<void>;
}

const INITIAL: CodeTestState = { phase: 'idle', hasSession: false, reply: '', error: null };

export function useCodeTest(): CodeTestHook {
  const [state, setState] = useState<CodeTestState>(INITIAL);
  const sessionRef = useRef<PublicSessionResponse | null>(null);

  const start = useCallback(async (code: string) => {
    setState({ phase: 'opening', hasSession: false, reply: '', error: null });
    try {
      const sess = await issueCodeSession({
        code, visitor_name: OWNER_TEST_VISITOR_NAME,
      });
      sessionRef.current = sess;
      setState({ phase: 'ready', hasSession: true, reply: '', error: null });
    } catch (e) {
      sessionRef.current = null;
      setState({
        phase: 'error', hasSession: false, reply: '',
        error: e instanceof Error ? e.message : 'open session failed',
      });
    }
  }, []);

  const send = useCallback(async (text: string) => {
    await runSend(text, sessionRef.current, setState);
  }, []);

  return { state, start, send };
}

async function runSend(
  text: string,
  sess: PublicSessionResponse | null,
  setState: React.Dispatch<React.SetStateAction<CodeTestState>>,
): Promise<void> {
  const trimmed = text.trim();
  if (trimmed === '') return;
  if (sess === null) {
    setState((s) => ({ ...s, phase: 'error', error: 'no session opened' }));
    return;
  }
  setState((s) => ({ ...s, phase: 'streaming', reply: '', error: null }));
  await streamReplyInto(sess, trimmed, setState);
}

async function streamReplyInto(
  sess: PublicSessionResponse,
  text: string,
  setState: React.Dispatch<React.SetStateAction<CodeTestState>>,
): Promise<void> {
  try {
    let body = '';
    // What the owner sees when trying a code in the panel must be **the exact
    // same thing** a visitor sees — so this also assembles the system prompt
    // (fragment + this code's persona). Without it, the self-test preview
    // would look "cleaner" than the real visitor experience.
    const system = await composeChatSystem(sess);
    for await (const ev of streamChatMessage(
      sess.conversation_id, sess.session_token, text, system,
    )) {
      if (ev.kind === 'token' && ev.text) {
        body += ev.text;
        setState((s) => ({ ...s, phase: 'streaming', reply: body }));
      }
    }
    setState((s) => ({ ...s, phase: 'done', reply: body }));
  } catch (e) {
    logger.error('code self-test stream', e);
    setState((s) => ({
      ...s, phase: 'error',
      error: e instanceof Error ? e.message : 'stream failed',
    }));
  }
}
