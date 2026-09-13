// block-graph.spec.ts — the block dependency graph (the fiber view's data layer).
//
// The fiber view draws the composition and locks a block's Active toggle while something relies on
// it — both need the graph: each block's provides/requires and, crucially, what relies on it
// (required_by). GET /api/admin/blocks/graph returns that. Black-box: install a provider and a
// consumer that requires it, then assert the provider's required_by names the consumer and the
// consumer's requires names the provider's seam.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, login } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const OWNER = {
  email: 'block-graph@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'blockgraph',
  fullName: 'Block Graph Owner',
};

interface GraphNode { id: string; provides: string; requires: string[]; required_by: string[] }

function manifest(id: string, provides: string, requires?: string): string {
  const lines = [`id: ${id}`, `title: ${id}`, 'version: "1"', `provides: ${provides}`];
  if (requires) lines.push('requires:', `  - ${requires}`);
  return lines.join('\n');
}

async function install(request: APIRequestContext, csrf: string, m: string): Promise<number> {
  // eslint-disable-next-line e2e-local/no-direct-mutating-api -- action under test: block install
  const res = await request.post(`${BACKEND}/api/admin/blocks`, {
    headers: { 'X-Csrftoken': csrf }, data: { manifest: m },
  });
  return res.status();
}

async function graph(request: APIRequestContext, csrf: string): Promise<GraphNode[]> {
  const res = await request.get(`${BACKEND}/api/admin/blocks/graph`, {
    headers: { 'X-Csrftoken': csrf },
  });
  expect(res.status(), await res.text()).toBe(200);
  return ((await res.json()) as { nodes: GraphNode[] }).nodes;
}

test.describe('block dependency graph exposes provides/requires + what relies on each', () => {
  test('a provider block reports the consumer in required_by',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      resetInstance();
      await claim(request, findSetupToken(), {
        email: OWNER.email, password: OWNER.password,
        handle: OWNER.handle, fullName: OWNER.fullName,
      });
      const { csrf } = await login(request, OWNER.email, OWNER.password);

      // provider offers seam "gdb"; consumer requires it.
      expect(await install(request, csrf, manifest('graphdb', 'gdb'))).toBe(201);
      expect(await install(request, csrf, manifest('graphuser', 'ga', 'gdb'))).toBe(201);

      const nodes = await graph(request, csrf);
      const provider = nodes.find((n) => n.id === 'graphdb');
      const consumer = nodes.find((n) => n.id === 'graphuser');
      expect(provider, 'provider node present').toBeTruthy();
      expect(consumer, 'consumer node present').toBeTruthy();

      // The reverse edge the relied-lock needs: the consumer relies on the provider.
      expect(provider!.required_by, 'provider is relied upon by the consumer')
        .toContain('graphuser');
      // The forward edge: the consumer requires the provider's seam.
      expect(consumer!.requires, 'consumer requires the provider seam').toContain('gdb');
      // A block nothing relies on has an empty required_by (never null).
      expect(consumer!.required_by, 'consumer relied upon by no one').toEqual([]);

      await request.dispose();
    });
});
