// chunk.test.ts —— 切分。**替身在这件事上一个字都不会说**（它多长都收），
// 所以判据只能自己立。
//
// 不切的后果不是「显示不全」，是平台**整条拒收** —— 读者什么都收不到，
// 而日志里只有一条 400。owner 的语料答起来动辄两三千字，这不是边角情况。

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
    // 切分不许吃掉内容 —— 少一段的话，读者读到的是一个悄悄残缺的答案。
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
    // 找不到体面断点时切坏一个词，也好过整条发不出去。
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
