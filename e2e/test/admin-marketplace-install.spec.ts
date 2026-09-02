// admin-marketplace-install.spec.ts -- #48-3 real install-from-market.
//
// User story: owner searches marketplace -> installs a github skill -> backend fetches
// that skill's SKILL.md (mock serves base64 contents), parses frontmatter, creates a
// real skill -> it appears in the /skills list, prompt = SKILL.md body. Real service
// (job-board mock), no frontend mock.

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

interface MarketSkill {
  id: string; name: string; source: string; version: string; description: string;
}
interface SkillRow { name: string; prompt: string; source: string }

test.describe('marketplace install', () => {
  test('github search results carry a description from SKILL.md (UX-13)',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      await setup(request);
      await login(request, OWNER.email, OWNER.password);
      const market = await searchGitHub(request);
      expect(market.length).toBeGreaterThan(0);
      // Each result's description is enriched from its SKILL.md, not the blank ""
      // the listing used to return (which made the cards a blind install — UX-13).
      for (const s of market) {
        expect(s.description, `skill ${s.id} must have a description`).not.toBe('');
      }
      await request.dispose();
    });

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

  test('paste a SKILL.md → installs directly as a manual skill (no network)',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      await setup(request);
      const { csrf } = await login(request, OWNER.email, OWNER.password);

      const md = [
        '---',
        'name: pasted-skill',
        'description: a skill the owner pasted by hand',
        'allowed-tools: [corpus_search]',
        '---',
        '',
        '# Pasted',
        'PASTED-MANUAL-MARKER body instructions.',
      ].join('\n');

      const res = await request.post(`${BACKEND}/api/admin/marketplace/install-manual`, {
        headers: { 'X-Csrftoken': csrf },
        data: { skill_md: md, name: '' },
      });
      expect(res.status()).toBe(201);

      const skills = await listSkills(request);
      const manual = skills.find((s) => s.source === 'manual');
      expect(manual, 'manual skill present').toBeTruthy();
      // frontmatter name wins when no explicit name is passed.
      expect(manual!.name).toBe('pasted-skill');
      expect(manual!.prompt).toContain('PASTED-MANUAL-MARKER');
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
