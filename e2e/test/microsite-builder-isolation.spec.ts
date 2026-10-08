// microsite-builder-isolation.spec.ts —— one page's build-time code cannot touch another page's
// published files.
//
// The prerender step (builder/runner.mjs) imports the page's module in node, so module-level code
// is a build-time program on the builder (microsite-builder-sandbox.spec.ts). Every published page
// lives under the shared output volume /srv/microsites/<page_id>/<build_id>/dist. Before, the
// prerender ran as the same user that owns that volume: a page could rewrite every other page's
// published files.
//
// The probe page walks the volume at build time, tries to overwrite every published index.html
// and to create a directory at the volume root, and prints how many attempts got through into the
// markup the prerender bakes. The victim page, published first, must still serve its own bytes.
//
// RED on the old builder: WROTE-1 (or more) MKDIR-OK, and /p/victim serves PWNED.

import { test, expect } from '@/fixtures/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { findSetupToken, resetInstance } from '@/fixtures/instance';
import { publishPage } from '@/fixtures/microsite-rig';

const OWNER = {
  email: 'isolation@example.com', password: 'correct-horse-battery-staple',
  handle: 'isolationowner', fullName: 'Isolation Owner',
};

const VICTIM_APP = `
export default function App() {
  return <main><h1>VICTIM_OWN_CONTENT</h1></main>;
}
`.trim();

const PROBE_APP = `
const node = (globalThis as any).process;

function probe(): string {
  if (typeof node?.getBuiltinModule !== 'function') return 'NO-NODE';
  const fs = node.getBuiltinModule('node:fs');
  const root = '/srv/microsites';
  let found = 0;
  let wrote = 0;
  try {
    for (const page of fs.readdirSync(root)) {
      let builds: string[] = [];
      try { builds = fs.readdirSync(root + '/' + page); } catch { continue; }
      for (const build of builds) {
        const file = root + '/' + page + '/' + build + '/dist/index.html';
        if (!fs.existsSync(file)) continue;
        found++;
        try { fs.writeFileSync(file, '<h1>PWNED</h1>'); wrote++; } catch { /* refused */ }
      }
    }
  } catch { /* the volume is not even listable: also fine */ }
  let mkdir = 'OK';
  try { fs.mkdirSync(root + '/sm-probe-dir'); } catch { mkdir = 'BLOCKED'; }
  return 'FOUND-' + found + ' WROTE-' + wrote + ' MKDIR-' + mkdir;
}

const PROBE = probe();

export default function App() {
  return <main><p data-sm="probe">{PROBE}</p></main>;
}
`.trim();

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('microsite builder · a page cannot write another page’s published files', () => {
  test.describe.configure({ mode: 'serial', timeout: 600_000 });

  test.beforeAll(async () => {
    resetInstance();
  });

  test('the probe page’s build-time writes to the volume are refused; the victim serves its own bytes',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      await claim(request, findSetupToken(), OWNER);
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      await publishPage(request, csrf, 'victim', VICTIM_APP, 300_000);
      expect(await (await request.get('/p/victim')).text()).toContain('VICTIM_OWN_CONTENT');

      await publishPage(request, csrf, 'probe', PROBE_APP, 300_000);
      const raw = await (await request.get('/p/probe')).text();
      const m = /FOUND-(\d+) WROTE-(\d+) MKDIR-(\w+)/.exec(raw);
      expect(m, `the prerender printed the probe: ${raw.slice(0, 400)}`).not.toBeNull();
      const [, found, wrote, mkdir] = m ?? [];
      // Without this, "wrote 0" could just mean the probe never saw the victim's files.
      expect(Number(found), 'the probe found the victim’s published file').toBeGreaterThan(0);
      expect(Number(wrote), 'no published file of another page was overwritten').toBe(0);
      expect(mkdir, 'the volume root refuses a new directory').toBe('BLOCKED');

      const victim = await (await request.get('/p/victim')).text();
      expect(victim, 'the victim still serves its own page').toContain('VICTIM_OWN_CONTENT');
      expect(victim).not.toContain('PWNED');
      expect(raw, 'the probe page itself was published').toContain('FOUND-');
      await request.dispose();
    });
});
