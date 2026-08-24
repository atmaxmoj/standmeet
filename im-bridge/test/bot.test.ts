// bot.test.ts —— 平台那一层的翻译，和**两道必须挡住的门**。
//
// 这两道门不是边角：不挡 `isMe`，我们自己的回复被平台回灌就是自问自答的死循环；
// 不挡 `isBot`，两个机器人能互相刷到限流为止 —— 而账单和配额记在 owner 头上。

import { describe, expect, it } from 'vitest';

import { shouldAnswer, toInbound, type IncomingLike } from '../src/bot.js';

function msg(over: Partial<IncomingLike['author']> = {}, text = 'hello'): IncomingLike {
  return {
    text,
    author: {
      userId: 'u1', userName: 'rae', fullName: 'Rae Chen',
      isBot: false, isMe: false, ...over,
    },
  };
}

describe('平台那一层：谁该被回答', () => {
  it('普通人的话：答', () => {
    expect(shouldAnswer(msg())).toBe(true);
  });

  it('**我们自己发的话**：不答 —— 平台回灌 + 不挡 = 自问自答的死循环', () => {
    expect(shouldAnswer(msg({ isMe: true }))).toBe(false);
  });

  it('**别的机器人**：不答 —— 两个 bot 能互相刷到限流，而账单是 owner 的', () => {
    expect(shouldAnswer(msg({ isBot: true }))).toBe(false);
  });

  it('平台没说是不是机器人：**按人处理**', () => {
    // 反过来（未知按机器人挡）的代价是把真人挡在外面，而他对着一个不回话的窗口
    // 干等，完全看不出为什么。宁可多答一个机器人，不可少答一个人。
    expect(shouldAnswer(msg({ isBot: 'unknown' }))).toBe(true);
  });

  it('空消息（只有附件/表情那种）：不答', () => {
    expect(shouldAnswer(msg({}, '   '))).toBe(false);
  });
});

describe('平台那一层：翻译', () => {
  it('稳定 id 和名字都带过去', () => {
    expect(toInbound(msg())).toEqual({
      userID: 'u1', displayName: 'Rae Chen', text: 'hello',
    });
  });

  it('没有 fullName 时退回 userName —— 名字要进 owner 的账，不能是空的', () => {
    expect(toInbound(msg({ fullName: '' })).displayName).toBe('rae');
  });
});
