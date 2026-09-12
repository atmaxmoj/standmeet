// block-costs-no-code.spec.ts —— THE ACCEPTANCE TEST FOR THE WHOLE DESIGN.
//
// `docs/design/plugin/tests.md` §3 names it in those words: "a fixture block that
// exists only as data appears in the admin with its settings form rendered from its
// Config schema."
//
// What it guards against is the shape being replaced. Before this change every
// block had a hand-written Go registration — twenty `capreg_*.go` files — plus a
// row in the composition root, so "add a block" meant "edit us". A seam name was
// not even data: `mail.send` declared `requires: [smtp]` because the string "smtp" had
// been hand-registered in `axisconn/register.go`, welding one block to one supplier.
//
// Everything the owner does here is done by clicking. A version of this spec that
// POSTed the manifest would stay green with no owner-facing surface at all, which is
// the one outcome that would make the whole design useless: the owner is the person
// who installs blocks.
//
// Written before the substrate that satisfies it, and RED until then — a guard whose
// first run is green has never been shown to be able to fail.

import { test, expect } from '@/fixtures/test';

import { claimFreshOwner } from '@/fixtures/seed';
import { gotoAdminSection, BLOCKS_SECTION } from '@/fixtures/navigate';

const OWNER = {
  email: 'block-nocode@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'blocknocode',
  fullName: 'Block NoCode Owner',
};

// A deliberately absurd id. A real word could appear in unrelated code and make the
// companion "no source file names it" gate vacuous.
const FIXTURE_ID = 'acme.widget.zzfixture';

// The entire block. No Go, no TypeScript, no registration — a declaration and nothing
// else. `config` is what the admin must render a form from without knowing what a
// widget is: a type, a label and a range is all a form needs.
const FIXTURE_MANIFEST = `id: ${FIXTURE_ID}
title: Acme Widget
version: "1"
shape: visitor_only
acl: role_granted
visitor_tools:
  - acme_do_thing
config:
  - key: widget_count
    label: Widgets per turn
    type: int
    description: How many widgets to emit.
    default: "3"
    min: 1
    max: 10
`;

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('a block costs no code', () => {
  test.beforeAll(async ({ playwright }) => {
    await claimFreshOwner(playwright, OWNER);
  });

  test('paste a declaration-only block into the panel → it is listed with its own settings form',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, BLOCKS_SECTION);

      const installer = adminPage.getByTestId('block-install-panel');
      // 20s, not 5: the section fetches the supplier catalog and list on first paint.
      // The assertion is unchanged — a panel that never renders still fails.
      await expect(installer, 'the owner has somewhere to put a block').toBeVisible({
        timeout: 20_000,
      });
      await installer.getByTestId('block-manifest-input').fill(FIXTURE_MANIFEST);
      await installer.getByTestId('block-install-submit').click();

      // Half one: it is there, and it is there by its own declared title. Assert the
      // row's CONTENTS — a spec that checked "no error appeared" would also pass on a
      // panel that rendered nothing.
      const row = adminPage.getByTestId(`block-row-${FIXTURE_ID}`);
      await expect(row).toBeVisible({ timeout: 10_000 });
      await expect(row).toContainText('Acme Widget');

      // Half two, the load-bearing half: the settings form comes from the block's own
      // declaration. Nothing in our code knows a widget has a count, what it is
      // labelled, or that it stops at ten.
      await row.getByTestId('block-configure').click();
      const form = adminPage.getByTestId(`block-config-${FIXTURE_ID}`);
      await expect(form).toBeVisible();
      // The form's shell renders first and its fields arrive from the block's own
      // declaration a request later, so the label needs its own wait — five seconds is
      // the default and the install that precedes this is still settling.
      await expect(form.getByText('Widgets per turn')).toBeVisible({ timeout: 15_000 });

      const input = form.getByTestId('block-config-field-widget_count');
      await expect(input, 'a form cannot render an untyped field').toHaveAttribute('type', 'number');
      await expect(input, 'the declared default reaches the field').toHaveValue('3');
      await expect(input).toHaveAttribute('min', '1');
      await expect(input).toHaveAttribute('max', '10');
    });

  test('the setting the owner types is kept',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, BLOCKS_SECTION);
      await adminPage.getByTestId(`block-row-${FIXTURE_ID}`)
        .getByTestId('block-configure').click();

      const form = adminPage.getByTestId(`block-config-${FIXTURE_ID}`);
      const input = form.getByTestId('block-config-field-widget_count');
      await input.fill('7');
      await form.getByTestId('block-config-save').click();

      // Wait for the save to LAND before reloading. Reloading straight after the click
      // aborts the request that is still in flight, and the value then reads back as
      // the default — which looks exactly like "the setting was not kept", the very
      // thing this case exists to detect. The toast is the wait, not the proof.
      await expect(adminPage.getByText('Saved')).toBeVisible({ timeout: 10_000 });

      // The proof is the reload: a generic "saved" says nothing about whether THIS
      // value survived the round trip.
      await adminPage.reload();
      await gotoAdminSection(adminPage, BLOCKS_SECTION);
      await adminPage.getByTestId(`block-row-${FIXTURE_ID}`)
        .getByTestId('block-configure').click();
      await expect(
        adminPage.getByTestId(`block-config-${FIXTURE_ID}`)
          .getByTestId('block-config-field-widget_count'),
      ).toHaveValue('7');
    });
});
