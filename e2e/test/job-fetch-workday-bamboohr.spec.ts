// job-fetch-workday-bamboohr.spec.ts —— J.6b: 两个新 ATS direct adapter
// workday (CXS POST) + bamboohr (careers/list GET) 注册 + fetch_new。
// 跟 JBA 那条平行；走真 ATS 而不是聚合 archive。

import { test, expect } from '@/fixtures/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { jobsFetchNew, jobsRegisterSource } from '@/fixtures/jobs';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

test.describe('jobs.fetch_new (workday + bamboohr) direct ATS adapters', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
  });

  test('workday: POST CXS endpoint → 2 fixture jobs surface',
    async ({ request }) => {
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      const token = await createAPIToken(request, csrf, 'workday-spec');
      const sid = await initMCP(request, token);

      const src = await jobsRegisterSource(request, token, sid, {
        kind: 'workday',
        label: 'Acme Workday',
        config: { tenant: 'acme', wd: '5', site: 'careers' },
      });
      expect(src.kind).toBe('workday');

      const fetched = await jobsFetchNew(request, token, sid, src.id);
      expect(fetched.jobs).toHaveLength(2);
      const titles = fetched.jobs.map((j) => j.title);
      expect(titles).toContain('Senior Software Engineer (Backend)');
      expect(titles).toContain('Staff Data Scientist');
    });

  test('bamboohr: GET careers/list → 3 fixture jobs (incl null location)',
    async ({ request }) => {
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      const token = await createAPIToken(request, csrf, 'bamboohr-spec');
      const sid = await initMCP(request, token);

      const src = await jobsRegisterSource(request, token, sid, {
        kind: 'bamboohr',
        label: 'Zeta BambooHR',
        config: { company: 'zeta' },
      });
      expect(src.kind).toBe('bamboohr');

      const fetched = await jobsFetchNew(request, token, sid, src.id);
      expect(fetched.jobs).toHaveLength(3);
      const titles = fetched.jobs.map((j) => j.title);
      expect(titles).toContain('Senior Backend Engineer');
      expect(titles).toContain('Product Designer');
      // null location → empty string，不应 crash 或丢条
      expect(titles).toContain('Customer Success Manager');
      // tag 含 department + employmentStatus
      const backend = fetched.jobs.find((j) => j.title === 'Senior Backend Engineer');
      expect(backend?.tags).toContain('Engineering');
      expect(backend?.tags).toContain('Full-Time');
    });
});
