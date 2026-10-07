// dialog-stream.test.ts —— the chat engine's turn state machine, run without a browser (refactor
// ledger R21). Every surface renders what these functions decide: whether the turn is still
// pending, what the answer says, which notes it cites, which line hangs under it. Each case
// names the bug it guards.

import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '@standmeet/agent-core';

import {
  UNREACHABLE_CODE, handleAgentEvent, makeAccumulator, markFailed, newPendingDialog,
  splitParas, turnSucceeded, updateDialog,
} from './dialog-stream.js';

function run(events: AgentEvent[]) {
  const accum = makeAccumulator();
  for (const ev of events) handleAgentEvent(ev, accum);
  return accum;
}

function read(id: string, genre: string, extra: Record<string, unknown> = {}): AgentEvent {
  return {
    type: 'tool_completed',
    result: { name: 'corpus_read', ok: true, result: { id, genre, path: `p/${id}`, title: id, body: 'b', ...extra } },
  } as AgentEvent;
}

describe('the answer body', () => {
  it('a tool call folds the narration before it out of the answer (F-A-4)', () => {
    const a = run([
      { type: 'llm_chunk', text: 'Let me look that up.' },
      { type: 'tool_started', name: 'corpus_search', args: { query: 'x' } },
      { type: 'llm_chunk', text: 'The answer.' },
    ]);
    expect(a.body).toBe('The answer.');
  });

  it('a recovered answer replaces the partial and clears the cut error', () => {
    const a = run([
      { type: 'llm_chunk', text: 'half' },
      { type: 'error', message: 'The connection dropped.' },
      { type: 'answer_recovered', text: 'The whole answer.' },
    ]);
    expect(a.body).toBe('The whole answer.');
    expect(a.errorMsg).toBe('');
    expect(turnSucceeded(a)).toBe(true);
  });
});

describe('citations', () => {
  it('a note read twice is cited once', () => {
    expect(run([read('n1', 'wiki'), read('n1', 'wiki')]).citations).toHaveLength(1);
  });

  it('a writing is citable; subjectivity and a hidden wiki note are not', () => {
    const a = run([
      read('w1', 'writing'), read('s1', 'subjectivity'), read('h1', 'wiki', { show_as_source: false }),
    ]);
    expect(a.citations.map((c) => c.id)).toEqual(['w1']);
  });

  it('a failed read cites nothing', () => {
    const a = run([{
      type: 'tool_completed',
      result: { name: 'corpus_read', ok: false, result: { id: 'x', genre: 'wiki' } },
    } as AgentEvent]);
    expect(a.citations).toHaveLength(0);
  });
});

describe('the dialog a turn becomes', () => {
  const pending = [newPendingDialog('d1', 'q?')];

  it('stays pending, with the throbber, until text arrives', () => {
    const a = run([{ type: 'tool_started', name: 'corpus_search', args: {} }]);
    const [d] = updateDialog(pending, 'd1', a, true);
    expect(d?.pending).toBe(true);
    expect(d?.currentTool).not.toBeNull();
  });

  it('a landed turn drops the throbber and keeps the tool cards', () => {
    const a = run([read('n1', 'wiki'), { type: 'llm_chunk', text: 'Done.' }]);
    const [d] = updateDialog(pending, 'd1', a, false);
    expect(d?.currentTool).toBeNull();
    expect(d?.answer.toolCalls).toHaveLength(1);
    expect(d?.answer.paras).toEqual(['Done.']);
  });

  it('an error after partial text keeps the text and hangs the error as a notice (F-A-32)', () => {
    const a = run([read('n1', 'wiki'), { type: 'llm_chunk', text: 'Part one.' },
      { type: 'error', message: 'The connection dropped.' }]);
    const [d] = updateDialog(pending, 'd1', a, false);
    expect(d?.failed).toBe(true);
    expect(d?.answer.paras).toEqual(['Part one.']);
    expect(d?.answer.citations).toHaveLength(1);
    expect(d?.answer.notice).toBe('The connection dropped.');
  });

  it('a gone session never shows its sentence in the dialog', () => {
    const a = run([{ type: 'error', message: 'Your session ended.', code: 'session_gone' }]);
    expect(a.errorMsg).toBe('');
    expect(a.goneMsg).toBe('Your session ended.');
  });

  it('each stop reason says its own wall; an unknown one says nothing (UX-84)', () => {
    const notice = (stop: string) => {
      const a = run([{ type: 'llm_chunk', text: 'x' },
        { type: 'turn_finished', stopReason: stop } as AgentEvent]);
      return updateDialog(pending, 'd1', a, false)[0]?.answer.notice;
    };
    expect(notice('max_tokens')).toContain('output budget');
    expect(notice('no_answer')).toContain('narrower question');
    expect(notice('end_turn')).toBeUndefined();
    expect(notice('some_new_stop')).toBeUndefined();
  });

  it('an unbacked claim outranks truncation (F-A-37)', () => {
    const a = run([{ type: 'llm_chunk', text: 'Booked.' },
      { type: 'turn_finished', stopReason: 'claim_unbacked' }]);
    expect(updateDialog(pending, 'd1', a, false)[0]?.answer.notice).toContain('nothing was actually done');
  });

  it('a failed turn shows a spoken code, never its raw message (2026-10-04)', () => {
    const [d] = markFailed(pending, 'd1', 'error: issue session: 400');
    expect(d?.answer.paras).toEqual([]);
    expect(d?.answer.errorCode).toBe(UNREACHABLE_CODE);
    expect(markFailed(pending, 'd1', 'x', 'rate_limited')[0]?.answer.errorCode).toBe('rate_limited');
  });
});

describe('splitParas', () => {
  it('splits on blank lines', () => {
    expect(splitParas('a\n\nb')).toEqual(['a', 'b']);
  });

  it('a blank line inside a fence or $$ block does not split it (v0.1.99)', () => {
    const fenced = '```mermaid\ngraph TD\n\nA-->B\n```';
    expect(splitParas(fenced)).toEqual([fenced]);
    expect(splitParas('$$\nx\n\ny\n$$')).toHaveLength(1);
  });
});
