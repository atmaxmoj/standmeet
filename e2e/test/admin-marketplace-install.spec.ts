// admin-marketplace-install.spec.ts —— #48-3 真 install-from-market。
//
// 用户故事:owner 搜 marketplace → install 一个 github skill → 后端 fetch 该 skill
// 的 SKILL.md(mock serve base64 contents)、parse frontmatter、建成真 skill →
// 出现在 /skills 列表,prompt = SKILL.md 正文。真服务(job-board mock),无前端 mock。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, login } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const OWNER = {
  email: 'market-install@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'marketinstall',
  fullName: 'Market Install Owner',
};

interface MarketSkill { id: string; name: string; source: string; version: string }
interface SkillRow { name: string; prompt: string; source: string }

test.describe('marketplace install', () => {
  test('install a github skill → SKILL.md fetched + parsed into a real skill',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      await setup(request);
      const { csrf } = await login(request, OWNER.email, OWNER.password);

      const market = await searchGitHub(request);
      expect(market.length).toBeGreaterThan(0);
      const pick = market[0]!;

      const installRes = await request.post(`${BACKEND}/api/admin/marketplace/install`, {
        headers: { 'X-Csrftoken': csrf },
        data: { source: pick.source, id: pick.id, name: pick.name, version: pick.version },
      });
      expect(installRes.status()).toBe(201);

      const skills = await listSkills(request);
      const installed = skills.find((s) => s.source === 'marketplace');
      expect(installed, 'installed marketplace skill present').toBeTruthy();
      expect(installed!.prompt).toContain('INSTALLED-SKILL-MARKER');
      await request.dispose();
    });
});

async function setup(request: APIRequestContext): Promise<void> {
  resetInstance();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
}

async function searchGitHub(request: APIRequestContext): Promise<MarketSkill[]> {
  const res = await request.get(`${BACKEND}/api/admin/marketplace/search?source=github`);
  return await res.json() as MarketSkill[];
}

async function listSkills(request: APIRequestContext): Promise<SkillRow[]> {
  const res = await request.get(`${BACKEND}/api/admin/skills/`);
  return await res.json() as SkillRow[];
}
