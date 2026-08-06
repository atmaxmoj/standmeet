// kernel-prompt-capability-agnostic.spec.ts —— 没被授予的能力,不该出现在访客的系统提示里。
//
// 内核每一轮都往 instruction 里拼一段通用上下文:现在几点、owner 在哪个时区、访客在哪个时区。
// 这段跟"访客被授了什么"无关 —— 但它一直写着 "the owner's **calendar** runs in this timezone"
// 和 "before proposing or **scheduling** times"。于是一个只被授了语料、连预约工具都看不见的
// 访客,系统提示里照样躺着一句关于日程的指示:模型可能据此提议约时间,而那个能力根本不存在。
//
// check-core-agnostic 的基线上最后一条就是它。搬法:时区**事实**留在内核(简历、经历、"最近"
// 都要锚今天),怎么换算 / 什么时候反问 / 要不要双显那些**指示**归还给会排期的那个能力,
// 由它在自己的 MCP instructions 里说 —— 授了才出现。
//
// mock provider 把收到的 system prompt 原样回显成 `[system:...]`(见 mock-stack/llm-gateway
// 的 composeFinalReply),所以这里断的是**真正发给模型的那份**,不是 diag 的快照 ——
// 那一段是每轮拼的,快照里根本看不到。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, login } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { createRole } from '@/fixtures/roles';
import { issueSession, sendMessage } from '@/fixtures/visitor';

const OWNER = {
  email: 'kernelprompt@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'kernelprompt',
  fullName: 'Kernel Prompt Owner',
};

const CODE = 'KERNEL-PROMPT-001';

// 具体能力的词。这个访客一个日程工具都没有,系统提示里就不该出现它们。
const CAPABILITY_WORDS = /calendar|schedul|book a meeting|appointment/i;

test.describe('the always-on part of the system prompt names no capability', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await grantCorpusOnlyCode(request);
    await request.dispose();
  });

  test('a visitor granted only corpus carries no scheduling instruction', async ({ request }) => {
    const sess = await issueSession(request, {
      handle: OWNER.handle, code: CODE, visitor_name: 'Curious Reader',
    });
    const res = await sendMessage(request, sess, 'what does the owner work on?');
    expect(res.status()).toBe(200);
    const body = await res.text();

    // 先证明我们确实看到了那份 prompt —— 回显没了的话,下面那条"不含"会白白变绿。
    expect(body, 'the mock echoes the system prompt it received').toContain('[system:');
    expect(body, 'the generic time anchor is still injected').toContain('Current date and time:');

    expect(
      body,
      'this visitor has no booking tool — nothing in their prompt should talk about scheduling',
    ).not.toMatch(CAPABILITY_WORDS);
  });
});

// grantCorpusOnlyCode —— 一个只给语料、不给任何能力的 role + code。
async function grantCorpusOnlyCode(request: APIRequestContext): Promise<void> {
  const { csrf } = await login(request, OWNER.email, OWNER.password);
  const role = await createRole(request, csrf, {
    name: 'reader-only',
    description: 'corpus only, no capabilities',
    corpus_uris: ['wiki://**'],
  });
  await createCode(request, csrf, {
    code: CODE, label: 'corpus-only reader', assumed_role_id: role.id,
  });
}
