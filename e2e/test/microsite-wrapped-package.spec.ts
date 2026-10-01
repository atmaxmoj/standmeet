// microsite-wrapped-package.spec.ts —— a microsite uses an npm package or a font the builder image
// does not ship (docs/design/plugin/microsite-build.md "Wrapping an npm package as a block";
// docs/design/plans/microsite-wrapped-packages.md). The owner installs a block whose manifest says
// `package: <name>@<version>`; the instance installs it once with lifecycle scripts off, and every
// later microsite build finds it in node_modules. Owner 2026-10-01: "微站引用外部包、字体的两条 spec … 做一下".
//
// The packages come from the mock npm registry (mock-stack/job-board/npm_fixtures.go):
//   - sm-fixture-pristine: its postinstall rewrites index.js to say POSTINSTALL_RAN.
//   - sm-fixture-font: a stylesheet and the woff2 it points at.
//
// RED on the code of 2026-10-01: a manifest's `package:` is ignored, nothing is installed, and the
// builds below fail on an import the builder cannot resolve.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { deleteBlock, findBlock, installBlockManifest } from '@/fixtures/blocks';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { buildSettled as buildSettledIn, promoteBuild } from '@/fixtures/microsite-rig';
import { openReader } from '@/fixtures/navigate';
import { MOCK_BASE } from '@/fixtures/stack';

const OWNER = {
  email: 'wrapped@example.com', password: 'correct-horse-battery-staple',
  handle: 'wrapped', fullName: 'Wrapped Owner',
};

const PRISTINE_PAGE = `
import React from 'react';
import word from 'sm-fixture-pristine';
export default function App() { return <p data-testid="pkg-word">{word}</p>; }
`.trim();

const FONT_PAGE = `
import React from 'react';
import 'sm-fixture-font/index.css';
export default function App() { return <p data-testid="pkg-font" className="sm-fixture">Aa</p>; }
`.trim();

const manifest = (id: string, pkg: string) =>
  `id: ${id}\ntitle: ${id}\nversion: "1"\npackage: ${pkg}\n`;

let csrf = '';
let api: APIRequestContext;

test.describe.configure({ mode: 'serial', timeout: 600_000 });

test.describe('a microsite uses a package we did not ship', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    api = await playwright.request.newContext();
    await claim(api, findSetupToken(), OWNER);
    csrf = (await loginAPI(api, OWNER.email, OWNER.password)).csrf;
  });
  test.afterAll(async () => { await api.dispose(); });

  test('installing the block runs none of the package\'s install scripts', async ({ page }) => {
    expect(installWithScriptsOn('sm-fixture-pristine@1.0.0'), 'control: the script does fire when allowed')
      .toContain('POSTINSTALL_RAN');

    expect(await installBlock(manifest('pristine', 'sm-fixture-pristine@1.0.0')), 'installed').toBe(201);
    expect(await findBlock(api, csrf, 'pristine'), 'the block is listed').toBeDefined();

    const row = await buildSettled('pristine-page', PRISTINE_PAGE);
    expect(row.status, row.error).toBe('built');
    await promote('pristine-page', row.id);
    await openReader(page, '/p/pristine-page/');
    await expect(page.getByTestId('pkg-word'), 'the package as published, untouched by its script')
      .toHaveText('PRISTINE');
  });

  test('a page uses a font the block carries, and it really loads', async ({ page }) => {
    const before = await buildSettled('font-page', FONT_PAGE);
    expect(before.status, 'the builder does not ship it').toBe('failed');
    expect(before.error, 'the build names what is missing').toContain('sm-fixture-font');

    expect(await installBlock(manifest('fixturefont', 'sm-fixture-font@1.0.0')), 'installed').toBe(201);
    const after = await buildSettled('font-page', FONT_PAGE);
    expect(after.status, after.error).toBe('built');
    await promote('font-page', after.id);

    await openReader(page, '/p/font-page/');
    const line = page.getByTestId('pkg-font');
    await expect(line).toBeVisible();
    expect(await line.evaluate((el) => getComputedStyle(el).color), 'the block\'s stylesheet applies')
      .toBe('rgb(17, 34, 51)');
    expect((await line.evaluate((el) => getComputedStyle(el).fontFamily)).toLowerCase()).toContain('smfixtureface');
    const loaded = await page.evaluate(async () => {
      await document.fonts.load('16px SMFixtureFace');
      return [...document.fonts].find((f) => f.family.replace(/"/g, '') === 'SMFixtureFace')?.status ?? 'absent';
    });
    expect(loaded, 'the font file the block carries was served and decoded').toBe('loaded');
  });

  test('uninstalling the block takes the package away from the next build', async () => {
    expect(await deleteBlock(api, csrf, 'fixturefont'), 'uninstalled').toBeLessThan(300);
    const row = await buildSettled('font-page', FONT_PAGE);
    expect(row.status, 'the next build no longer finds it').toBe('failed');
    expect(row.error).toContain('sm-fixture-font');
  });
});

// installWithScriptsOn —— the control: the same package, installed by plain npm with scripts
// allowed, rewrites itself. Without this, "PRISTINE" could mean the fixture's script never worked.
function installWithScriptsOn(spec: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'sm-npm-'));
  try {
    execFileSync('npm', ['install', spec, '--prefix', dir, '--registry', `${MOCK_BASE}/npm`,
      '--cache', path.join(dir, '.cache'), '--no-audit', '--no-fund'], { stdio: 'pipe' });
    return readFileSync(path.join(dir, 'node_modules', spec.split('@')[0] ?? '', 'index.js'), 'utf8');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const installBlock = (text: string) => installBlockManifest(api, csrf, text);
const buildSettled = (slug: string, source: string) => buildSettledIn(api, csrf, slug, source);
const promote = (slug: string, buildID: string) => promoteBuild(api, csrf, slug, buildID);
