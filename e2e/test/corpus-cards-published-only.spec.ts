// corpus-cards-published-only.spec.ts —— GET /api/v1/corpus-cards, the keyless list a custom
// page (the redesigned homepage) uses to render corpus cards without hand-picking ids.
//
// The one guarantee that matters: it returns ONLY published entries, so a page listing these
// can never surface an unpublished note. Seed two wiki entries, publish just one, and assert the
// published one is there (with its title + excerpt + reader path) and the unpublished one is not.
// A regression that ignored `published` would leak Beta; one that returned nothing would drop
// Alpha — both fail here.
//
// Seeding lives in beforeAll (its own request context), so the heavy claim+seed doesn't run
// against the 30s per-test budget; the test body is just the keyless GET + assertions.

import { test, expect } from '@/fixtures/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { publishEntry, seedWiki } from '@/fixtures/corpus';

const OWNER = {
  email: 'corpuscards@example.com', password: 'correct-horse-battery-staple',
  handle: 'corpuscards', fullName: 'Corpus Cards Owner',
};

interface CardsResponse {
  cards: { title: string; excerpt: string; path: string }[];
}

test.describe('GET /api/v1/corpus-cards · published only', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'corpuscards-seed');
    const sid = await initMCP(request, token);
    const alpha = await seedWiki(request, token, sid, { title: 'Alpha', body: 'the alpha body' });
    await seedWiki(request, token, sid, { title: 'Beta', body: 'the beta body' });
    await publishEntry(request, token, sid, {
      genre: 'wiki', id: alpha.wikiID, excerpt: 'the alpha thought',
    });
    await request.dispose();
  });

  test('lists the published entry (title + excerpt + path); hides the unpublished one', async ({
    request,
  }) => {
    // Keyless / anonymous request — no bearer token.
    const res = await request.get('/api/v1/corpus-cards');
    expect(res.ok(), `corpus-cards should be 200, got ${res.status()}`).toBeTruthy();
    const body = (await res.json()) as CardsResponse;

    const beta = body.cards.find((c) => c.title === 'Beta');
    expect(beta, 'an UNPUBLISHED entry must never appear in corpus-cards').toBeUndefined();

    const card = body.cards.find((c) => c.title === 'Alpha');
    expect(card, 'the published entry must appear').toBeDefined();
    expect(card?.excerpt).toBe('the alpha thought');
    expect(card?.path, 'the card must link into the reader by path').toBe('alpha');
  });
});
