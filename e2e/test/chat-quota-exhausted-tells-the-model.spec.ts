// chat-quota-exhausted-tells-the-model.spec.ts —— F-B-14 ⭐⭐：**额度用完要说出来，而且要说
// 「已经做成的那些算数」。**
//
// prod 上驱 booking-book check 4 抓到的（2026-08-21，真码 max_bookings=2、真 Google）：前两场真订
// 上了（回执卡 + 日历 + 邀请信），第三次请求之后 AI 说 *"I don't have calendar-booking access right
// now … those first two confirmations were wrong: nothing actually got booked … No invites went out
// to anyone."* —— 而两场会好好地在 owner 的日历上。**产品把两场真的会取消在了嘴上。**
//
// 归因在闸的形状上，不在模型脾气上：额度用尽时宿主把整个能力藏掉，于是那一轮的 agent
//   · 手上没有订会工具，
//   · 系统提示里**却还留着**「你会订会」那段说明（fragment 从不问闸），
//   · 而**没有任何一句话**告诉它「你有过、你用完了、之前那两场算数」。
// 「从来没有」和「用完了」是同一份证据，模型对这份证据最自然的修复就是怀疑自己刚才的输出。
//
// 判据落在**产品告诉模型什么**，不赌模型会说什么（[[faicheck-deterministic-llm-loop-bug]] 一族）：
// 额度用尽的那一轮，发出去的那份消息里必须带着这句话。外加一条正对照 —— 之前那一场**真的订上了**
// （日历上有），否则「额度用完」这件事根本没发生，断言也就没有意义。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { getMockEvents } from '@/fixtures/gcal';
import {
  seedCodeVisitorOnConnectedOwner, teardownSeed, type CodedSeed,
} from '@/fixtures/gcal-setup';
import {
  lastGatewayRequest, resetGatewayRequests, scriptMockReplyText, scriptMockToolCall, sendAndDrain,
} from '@/fixtures/mock-llm-script';

// ALLOWANCE_MARK —— 宿主在额度用尽时替这个能力说的那句话里的定语。它只有那一句会写出来，
// 所以命中 = 模型真的被告知了（用工具名当 needle 判不了负：工具清单本来就在提示里）。
const ALLOWANCE_MARK = 'used up';

test.describe.serial('F-B-14 · a spent allowance is said out loud, and past results stand', () => {
  let seed: CodedSeed;

  test.beforeAll(async ({ playwright }) => {
    seed = await seedCodeVisitorOnConnectedOwner(playwright, {
      granted_skills: ['calendar.book'], max_bookings: 1,
    });
  });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('the turn after the allowance runs out carries the fact, not silence', async () => {
    test.setTimeout(180_000);
    const r: APIRequestContext = seed.request;
    await resetGatewayRequests(r);

    // 1) 把这张码唯一的那次额度用掉 —— 真订一场（mock provider 上真长出一个事件）。
    const bookTag = await scriptMockToolCall(r, {
      name: 'calendar_book',
      args: { topic: 'the only one', duration_min: 30, preferred_times: [future(5, 14)] },
    });
    await sendAndDrain(r, seed.visitor, `book me a 30-minute call${bookTag}`);

    // 正对照：额度确实被用掉了 —— 不是「一次都没成」。
    const evs = await getMockEvents(r);
    expect(
      evs.some((e) => e.summary.includes('the only one')),
      'guard: the first booking really happened, so the allowance really is spent',
    ).toBe(true);

    // 2) 再问一次。这一轮工具已经不在了 —— 问题是产品有没有把**为什么**告诉模型。
    const nextTag = await scriptMockReplyText(r, 'noted');
    await sendAndDrain(r, seed.visitor, `book me another one, please${nextTag}`);

    await expect.poll(
      async () => (await lastGatewayRequest(r, nextTag, ALLOWANCE_MARK)).found,
      { timeout: 30_000, message: 'the turn reached the model' },
    ).toBe(true);
    const req = await lastGatewayRequest(r, nextTag, ALLOWANCE_MARK);

    expect(
      req.contains,
      'the model is told the allowance is spent — without it, "no tool" and "never had one" are '
      + 'the same evidence, and the agent talks itself into retracting bookings that really exist',
    ).toBe(true);
  });
});

function future(days: number, hour: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}
