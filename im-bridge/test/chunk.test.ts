// chunk.test.ts —— chunking. **The stand-in has nothing to say about this** (it accepts any length),
// so the criteria have to come from us.
//
// The consequence of not chunking isn't "shows partially", it's the platform **rejecting the whole message** —
// the reader gets nothing at all, and the log shows only a 400. The owner's corpus routinely answers in two or three thousand characters, this isn't an edge case.

import { describe, expect, it } from 'vitest';

import { chunkForChat, DEFAULT_LIMIT } from '../src/chunk.js';

describe('把回答切成平台收得下的几条', () => {
  it('短答案原样一条', () => {
    expect(chunkForChat('short answer')).toEqual(['short answer']);
  });

  it('空的就不发 —— 别推一条空消息给人', () => {
    expect(chunkForChat('   ')).toEqual([]);
  });

  it('每一条都在上限之内', () => {
    const long = 'x'.repeat(5000);
    for (const part of chunkForChat(long)) {
      expect(part.length).toBeLessThanOrEqual(DEFAULT_LIMIT);
    }
  });

  it('切完拼回去，内容一个字不少', () => {
    const paras = Array.from({ length: 40 }, (_, i) =>
      `Paragraph ${i} about something the owner wrote at some length.`).join('\n\n');
    const joined = chunkForChat(paras).join('\n\n');
    // Chunking must not eat content — dropping a piece means the reader gets a silently truncated answer.
    expect(joined.replace(/\s+/g, ' ')).toBe(paras.replace(/\s+/g, ' '));
  });

  it('优先在段落边界断，而不是切在句子中间', () => {
    const a = 'A'.repeat(1200);
    const b = 'B'.repeat(1200);
    const parts = chunkForChat(`${a}\n\n${b}`);
    expect(parts).toHaveLength(2);
    expect(parts[0], 'split on the blank line').toBe(a);
    expect(parts[1]).toBe(b);
  });

  it('一整段没有标点的长文本：硬切，但仍然不超限', () => {
    // Breaking a word mid-way when there's no decent break point beats not sending the message at all.
    const parts = chunkForChat('y'.repeat(4000));
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.length <= DEFAULT_LIMIT)).toBe(true);
  });

  it('中文句号也算断点', () => {
    const s = `${'甲'.repeat(1000)}。${'乙'.repeat(1000)}`;
    const parts = chunkForChat(s);
    expect(parts[0]!.endsWith('。'), 'break after the full-width stop').toBe(true);
  });
});
