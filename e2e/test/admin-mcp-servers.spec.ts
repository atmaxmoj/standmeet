// admin-mcp-servers.spec.ts — CRUD for external MCP servers in the api·mcp section.
//
// User story: owner loads in an MCP server they got from elsewhere -> it appears in the
// list -> can be removed. Real backend /mcp-servers (POST/GET/DELETE), UI-driven.

import { test, expect } from '@/fixtures/test';
import type { Page } from '@playwright/test';

import { claimFreshOwner } from '@/fixtures/seed';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'mcp-crud@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'mcpcrud',
  fullName: 'MCP CRUD Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('admin external MCP servers CRUD', () => {
  test.beforeAll(async ({ playwright }) => {
    await claimFreshOwner(playwright, OWNER);
  });

  test('add an MCP server → appears in list → remove → gone',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'api-mcp');
      const panel = adminPage.getByTestId('mcp-servers-panel');
      await expect(panel).toBeVisible({ timeout: 5_000 });

      await panel.getByTestId('mcp-server-name').fill('my-tools');
      await panel.getByTestId('mcp-server-url').fill('https://mcp.example.com/mcp');
      await panel.getByTestId('mcp-server-add').click();

      const list = adminPage.getByTestId('mcp-servers-list');
      await expect(list.getByText('my-tools')).toBeVisible({ timeout: 5_000 });
      await expect(list.getByText('https://mcp.example.com/mcp')).toBeVisible();

      await list.getByRole('button', { name: 'remove' }).click();
      await expect(list.getByText('my-tools')).toHaveCount(0);
    });

  // F-D-8 — After a server registers successfully, its row shows only name and URL:
  // **nothing says whether the server is actually reachable, or what tools it offers**.
  // The owner attaching a server to a code is making a decision on the visitor's behalf,
  // and the only evidence they have is whether the URL they just pasted was typed right.
  //
  // The product **already knows** both facts — session assembly really dials the server
  // and lists its tools (that's where `ext_<name>_*` comes from) — it just never says so
  // on this page. Same shape as F-C-16: the calendar connector card used to say only
  // `connected` too, with no way to ask further; the fix there was a **read-only probe**.
  // This copies that precedent.
  //
  // Criterion: after clicking the probe, the row must report a **real result** — a tool
  // count when reachable (using the real mcp-server-mock in the dev stack, which really
  // answers tools/list), or the real reason when not. "Clicked, nothing happened" doesn't
  // count.
  //
  // The probe can't live in the marketplace domain: that server's auth header is
  // encrypted, and **the domain side never decrypts it** (the comment at
  // `capreg_ext_mcp.go:150` says it plainly: "decryption happens on the side that
  // implements MCPServerGetter (the composition root). There used to be a
  // buildAuthHeaders here doing its own cryptobox.Decrypt: assembly is inbound, inbound
  // doesn't decrypt"). So the correct shape matches hostdesk: **the domain declares a
  // port** ("ask whether this server answers, and what it offers"), **the composition
  // root implements it** (it already has `mcpclient.Dial` + `ListTools` —
  // `capreg_ext_mcp.go:149-163` is that code). = port + root wiring + op + route +
  // surface + guard.
  //
  // Done along that path: port (marketplace/usecase) + root wiring
  // (cmd/server/mcp_probe.go) + op (mcp_server_check) + route
  // (POST /mcp-servers/{id}/check) + surface (this check) + this guard.
  test('a registered server can be asked whether it answers, and what it offers',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'api-mcp');
      const panel = adminPage.getByTestId('mcp-servers-panel');
      await expect(panel).toBeVisible({ timeout: 5_000 });

      await panel.getByTestId('mcp-server-name').fill('probe-me');
      await panel.getByTestId('mcp-server-url').fill('http://mcp-server-mock:9100/mcp');
      await panel.getByTestId('mcp-server-add').click();

      // Locate **that row** (li), not the whole list: check's testid is unique within a
      // row, so this won't collide with strict mode once there's more than one server.
      const row = adminPage.getByTestId('mcp-servers-list')
        .locator('li').filter({ hasText: 'probe-me' });
      await expect(row).toBeVisible({ timeout: 5_000 });
      await row.getByTestId('mcp-server-check').click();

      // A real answer means it can report a tool count. 0 would also be a valid answer,
      // but this mock has tools, so the assertion is >=1 — asserting only "some text
      // appeared" would let a hardcoded "checked" pass too.
      //
      // The assertion targets `check-result`'s **text**: that testid is only attached to
      // the row once the answer is in; the in-flight state is a different one
      // (`check-pending`). The first version hung both states off the same name, so what
      // got read here was "asking..." — the name claims it's a result but it's really
      // still in progress.
      await expect(
        row.getByTestId('mcp-server-check-result'), '探针要报出真结果',
      ).toHaveText(/[1-9]\d*\s+tools?/i, { timeout: 20_000 });
    });

  // F-D-15 — **"unreachable" and "reachable but it refuses this credential" get said as
  // the same sentence, and that sentence is a lie.**
  //
  // Hit in a real environment (driving ext-mcp check 4): re-registered the real Hugging
  // Face MCP server, deliberately set a bad token, clicked CHECK -> the screen showed
  // **`no answer — internal error`**, HTTP 500. Two lies in five words: the other side
  // **did answer** (HF replied 401 Unauthorized), and that **is not** our internal error.
  //
  // The backend log told the whole truth, then it got thrown away:
  //   `dial mcp server: mcp server unreachable: streamable: initialize: transport error:
  //    authorization required; sse: … 405`
  // `mcpclient.Dial` wraps **every** failure in `ErrUnreachable` (dial.go:53), while
  // `authorization required` is mcp-go's typed sentinel, right there in the chain;
  // `mcpServerErr`'s classification table has no case for it, so it falls through to
  // `fp.OpErr` -> 500 -> the frontend's `checkFailed` renders it as
  // `no answer — internal error`. Same family as F-R-12 / F-C-42: calling a "refusal" an
  // "unreachable" ([[collapsed-error-class-kills-its-own-branch]]).
  //
  // The criterion needs to be able to fail, so both cases are asserted together: **the
  // bad-credential case must say "it refused"**, **and the truly-unreachable case must
  // still say "no answer"** — asserting only the former would let every failure get
  // relabeled "refused" and still pass ([[red-in-the-wrong-place]]). Neither case may say
  // `internal error`: the owner pasting the wrong thing is the normal case, not this
  // instance being broken.
  test('a server that answers but refuses the credential says so, not "internal error" (F-D-15)',
    ({ adminPage }) => expectProbeSays(adminPage, {
      name: 'refuses-me',
      url: 'http://mcp-server-mock:9100/mcp-auth',
      auth: ['X-Mock-Auth', 'not-the-right-token'],
      says: /rejected|refused/i,
    }));

  test('a server that truly cannot be reached still reads as no answer (F-D-15)',
    ({ adminPage }) => expectProbeSays(adminPage, {
      name: 'nobody-home',
      // Nothing is listening on this port — the connection is refused outright, which is
      // a different thing from "answered but refused".
      url: 'http://mcp-server-mock:9199/mcp',
      says: /no answer/i,
    }));
});

// expectProbeSays — register a server, click CHECK, read what its row reports.
async function expectProbeSays(
  page: Page,
  want: { name: string; url: string; auth?: [string, string]; says: RegExp },
): Promise<void> {
  await gotoAdminSection(page, 'api-mcp');
  const panel = page.getByTestId('mcp-servers-panel');
  await expect(panel).toBeVisible({ timeout: 5_000 });

  await panel.getByTestId('mcp-server-name').fill(want.name);
  await panel.getByTestId('mcp-server-url').fill(want.url);
  if (want.auth !== undefined) {
    await panel.getByTestId('mcp-server-auth-name').fill(want.auth[0]);
    await panel.getByTestId('mcp-server-auth-value').fill(want.auth[1]);
  }
  await panel.getByTestId('mcp-server-add').click();

  const row = page.getByTestId('mcp-servers-list')
    .locator('li').filter({ hasText: want.name });
  await expect(row).toBeVisible({ timeout: 5_000 });
  await row.getByTestId('mcp-server-check').click();

  const said = row.getByTestId('mcp-server-check-result');
  await expect(
    said, 'the probe has to name what actually happened',
  ).toContainText(want.says, { timeout: 25_000 });
  // Wait for the assertion above to hold first, so the element is guaranteed present —
  // only then can this negated assertion actually fail
  // ([[negated-assertion-passes-while-absent]]).
  await expect(
    said, 'the owner pasting the wrong thing is not this instance breaking',
  ).not.toContainText(/internal error/i);
}

