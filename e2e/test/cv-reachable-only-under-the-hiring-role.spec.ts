// cv-reachable-only-under-the-hiring-role.spec.ts —— CV 进语料，但只有招聘那条路看得见。
//
// 缺陷（面试模拟 2026-08-30 发现）：`subjectivity/cv.md` 在 vault 里，但**故意没同步进
// 生产语料**（里面是 PII：真名、学校、雇主、城市）。于是 flagship 那条路结构性地答不了
// 招聘官问得最多的那个问题 —— "你之前在哪工作，什么时间段"。agent 处理得很体面（明说
// 不编，见那次模拟的 Q8），但体面地答不上来仍然是答不上来。
//
// owner 拍板走 A：CV 进语料，标成非公开，只在 hiring role 下可达。机制不用发明 ——
// role 的 `corpus_uris` 就是干这个的。
//
// 判据必须成对，而且**正对照在前**：
//   只写"公开访客读不到"那半边的话，这条测试在 CV 根本没同步的今天就是绿的 ——
//   一条永远对的 deny 断言（「红得不知所以然被当成红得对」）。所以先证明招聘那条路
//   **真的读得到雇主和日期**，那半边红了才轮得到 deny 那半边说话。

import { test, expect } from '@/fixtures/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { createEntry } from '@/fixtures/genre-assets';
import { getRoleByName } from '@/fixtures/roles';
import { createCode } from '@/fixtures/codes';
import { issueByoaiSession, issueSession } from '@/fixtures/visitor';
import { grepTitles, searchTitles } from '@/fixtures/retrieval';

const OWNER = {
  email: 'cvowner@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'cvowner',
  fullName: 'Cee Vee',
};

// CV 是一条 **subjectivity** 条目，不是 wiki 笔记。
//
// 第一版把它当 wiki 种在 `subjectivity/cv` 这个路径下 —— 而 `invited` 圈的是
// `wiki://**`，于是**产品发出去的每一张码**（gate 批准码也在内）都看得见这份 PII。
// 测试当场把它抓了出来。subjectivity 是独立 scheme，本来就在 invited 之外；
// `hiring` role 再显式圈上 `subjectivity://cv` 那一条。
const CV_TITLE = 'cv';
// 判据锚点：招聘官真正要的两样 —— 雇主名 + 起止日期。语料里没有这两样，
// 这条路就还是答不上来，哪怕 CV 这个"文件"同步进去了。
const EMPLOYER = 'Northwind Logistics';
const TENURE = '2019-03 → 2022-11';
const CV_BODY = [
  '# Curriculum Vitae',
  '',
  `## ${EMPLOYER} — Senior Backend Engineer`,
  `${TENURE} · Hamilton, ON`,
  '',
  'Owned the dispatch pipeline and its verification harness.',
].join('\n');

test.describe('corpus · the CV is in the corpus, and only the hiring role can reach it', () => {
  let hiringCode = '';
  let plainCode = '';

  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'cv-acl-spec');
    const sid = await initMCP(request, token);

    // CV 进语料 —— 走 subjectivity 那条写口（owner 跟自己的 AI 写出来的自我模型）。
    await createEntry({ request, token, sid }, 'subjectivity', CV_TITLE, CV_BODY);

    // 两条 role 都用**产品自己种的那两条 builtin**，不是测试现编的。
    // 现编的话测的是我拼的 glob，而不是 owner 真实拿到的那份正列表
    // （[[which-path-is-the-green-on]]）。
    const hiring = await getRoleByName(request, 'hiring');
    const plain = await getRoleByName(request, 'invited');

    hiringCode = (await createCode(request, csrf, {
      code: 'HIRING-CV', label: 'hiring', assumed_role_id: hiring.id,
    })).code;
    plainCode = (await createCode(request, csrf, {
      code: 'PLAIN-CV', label: 'plain', assumed_role_id: plain.id,
    })).code;
    await request.dispose();
  });

  // ── 正对照先跑：招聘那条路必须真的拿得到雇主和日期 ──────────────────
  test('a hiring-role visitor can retrieve the employer and the dates',
    async ({ request }) => {
      const sess = await issueSession(request, {
        handle: OWNER.handle, mode: 'code', code: hiringCode, visitor_name: 'Recruiter Bob',
      });

      // 找得到这篇。
      expect(await searchTitles(request, sess, EMPLOYER)).toContain(CV_TITLE);
      // 而且里面那两个具体事实取得出来 —— 「找得到文件」不等于「答得出问题」。
      const hits = await grepTitles(request, sess, TENURE);
      expect(hits).toContain(CV_TITLE);
    });

  // ── 有了正对照，deny 这半边才有意义 ────────────────────────────────
  test('an ordinary code cannot reach the CV at all',
    async ({ request }) => {
      const sess = await issueSession(request, {
        handle: OWNER.handle, mode: 'code', code: plainCode, visitor_name: 'Ordinary Olive',
      });
      expect(await searchTitles(request, sess, EMPLOYER)).not.toContain(CV_TITLE);
      expect(await grepTitles(request, sess, TENURE)).not.toContain(CV_TITLE);
    });

  // 访客有**三档**（CLAUDE.md：access code / BYOAI / gate）。上面两条只覆盖了 code 那一档
  // 和匿名那一档 —— BYOAI 是第三档，它自带 key、只该看到语料的公开切片。
  // 少测一档就是少守一扇门，而 PII 只需要一扇门开着。
  test('a BYOAI visitor cannot reach the CV either',
    async ({ request }) => {
      const sess = await issueByoaiSession(request, {
        handle: OWNER.handle, byoai_provider: 'anthropic',
        byoai_key: 'sk-visitor-supplies-their-own',
        byoai_endpoint: 'http://mock.byoai.local', byoai_model: 'mock-model-byoai',
        visitor_name: 'Bring Your Own Bob',
      });
      expect(await searchTitles(request, sess, EMPLOYER)).not.toContain(CV_TITLE);
      expect(await grepTitles(request, sess, TENURE)).not.toContain(CV_TITLE);
    });

  // 第四档：完全匿名。没有码、没有 BYOAI，就是公开阅读器那条路。
  test('an anonymous public session cannot reach the CV either',
    async ({ request }) => {
      const sess = await issueSession(request, {
        handle: OWNER.handle, mode: 'public', visitor_name: 'Anonymous Ann',
      });
      expect(await searchTitles(request, sess, EMPLOYER)).not.toContain(CV_TITLE);
      expect(await grepTitles(request, sess, TENURE)).not.toContain(CV_TITLE);
    });
});

// 注：role 的 corpus_uris 圈进来只解决"够得着"。agent 还得**知道该去找** ——
// hiring prompt 里要有一句告诉它雇主和日期在 CV 里。那一半由
// jobloop-code-never-ships-bare.spec.ts 的 persona 断言覆盖。
