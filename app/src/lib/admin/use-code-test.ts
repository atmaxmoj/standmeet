// use-code-test —— admin /admin/codes VisitorPreviewModal 里的"试一下"。
// owner 想在不开隐身浏览器的情况下亲自跑一次 code session：
//   - 起 session（visitor_name = "(owner test)"，跟真访客在 conversations
//     列表里靠 visitor_name 一眼区分开）
//   - 发一条 message，订阅 SSE 流，把 token / done 拼到 reply

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
    // owner 在面板上试一张码,看到的必须跟访客看到的是**同一件事** —— 所以这里也要拼
    // system(fragment + 这张码的 persona)。少了它,自测预览会比真实访客体验"干净"一截。
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
