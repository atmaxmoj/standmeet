// vault-roundtrip-fidelity.spec.ts -- **a round trip is the identity
// transform**: upload it, export it back down, do nothing in between, and
// every file in the vault must come back byte-for-byte identical.
//
// Why a synthetic version is needed, and why the real-vault spec
// (`vault-roundtrip-noop.spec.ts`) isn't enough on its own: that one needs
// the owner's `~/Develop/writing/notes` to be present, and it **skips** on
// other machines -- and a skipped test case looks identical to a passing one
// in the report. So the shape of each defect needs its own pin on a
// **synthetic, always-runs** fixture too.
//
// The three cases here each pin one defect measured against the real vault
// (see F-L-66/67/68 for the numbers):
//
//   (1) raw stacks another block of frontmatter on top every round trip --
//       **with no ceiling**. 483 raw entries are affected. On import, raw is
//       fm-exempt (the whole file is body, `---` included); on export,
//       genre isn't distinguished and a `---publish---` block is always
//       written first. Two decisions that are each reasonable on their own
//       combine into a cycle.
//       The cost isn't just growing file size: after round 1, `tags`/`status`
//       are no longer frontmatter, and Obsidian's properties and tag graph
//       break instantly.
//
//   (2) fields the product itself stores are not written on export. The
//       `excerpt` / `css_classes` / `lang_labels` columns all exist in the
//       DB, and `ListAllForExport` never reads them at all. Same shape as
//       F-L-59 (the lang/aliases incident back then) -- that fix touched two
//       fields and never swept its neighbors.
//       And there's a second half: **keys the product doesn't recognize are
//       silently dropped**. In the real vault, `langs` appears in 596
//       entries, `aliases-zh` in 595, `owns` in 33 (32 of them wiki) -- these
//       aren't edge cases, they're the majority.
//
//   (3) a folder-note that is the only child of its folder gets relocated:
//       `x/y/y.md` -> `x/y.md`. 22 entries. The note's content didn't change,
//       but **the mirror must not restructure the owner's files**.
//
// The judgment criterion is always **byte-for-byte equality**, not "the body
// is still there". The existing roundtrip test in `sync-j-export.spec.ts`
// explicitly declares that it does not assert byte equality ("Byte-equality
// is the wrong bar — frontmatter is reconstructed"), so it is structurally
// incapable of catching "the round trip rewrote the file, and it keeps
// growing".

import * as fflate from 'fflate';
import type { APIRequestContext } from '@playwright/test';

import { test, expect } from '@/fixtures/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { uploadVault, downloadExport, type VaultFile } from '@/fixtures/obsidian';

const OWNER = {
  email: 'vault-fidelity@example.com', password: 'correct-horse-battery-staple',
  handle: 'vaultfidelity', fullName: 'Vault Fidelity Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

// Not using serial: each of the three tests does its own authoritative
// upload (a full-library replace), so they're already independent. Chaining
// them would mean the second two get skipped the moment the first goes red --
// and what's wanted here is **each of the three defects going red on its
// own**, not the first red masking the other two.
test.describe('vault mirror · a round trip is the identity', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
  });

  // (1) -- this is the only one of the three that **doesn't converge**: each
  // round stacks on another block, so this test checks two rounds.
  test('a raw note keeps its own frontmatter instead of gaining one every round',
    async ({ playwright }) => {
      const request = await playwright.request.newContext({ timeout: 120_000 });
      const vault: VaultFile[] = [{
        rel: 'raw/thinking/thinking.md',
        body: '---\ntags: [fact, thinking]\nstatus: seed\n---\n\n# Thinking\n\nhalf-formed.\n',
      }, {
        rel: 'raw/thinking/a-child.md',
        body: '---\nstatus: seed\n---\n\nkeeps the parent a folder.\n',
      }];

      const first = await roundTrip(request, vault);
      expect(first, 'round 1 returns the raw note byte-for-byte').toEqual(asMap(vault));

      // **Two rounds**: (1)'s defect is accumulation -- one round only shows
      // "gained a block", two rounds are needed to see "gains a block every round".
      const second = await roundTrip(request, toVault(first));
      expect(second, 'round 2 is a fixed point — nothing accumulates').toEqual(asMap(vault));

      await request.dispose();
    });

  // (2) -- fields the product stores + keys the product doesn't recognize,
  // both halves must come back.
  test('every frontmatter key comes back — the ones we store and the ones we do not understand',
    async ({ playwright }) => {
      const request = await playwright.request.newContext({ timeout: 120_000 });
      // Keys are chosen to match real-vault usage: inline arrays, hyphenated
      // keys, the multilingual group.
      const vault: VaultFile[] = [{
        rel: 'wiki/berlyne.md',
        body: [
          '---',
          'tags: [fact, cognitive-science]',      // known, and in **inline array** form
          'aliases-zh: [Berlyne 唤醒曲线]',        // unrecognized -- 595 entries in the real vault
          'aliases: [Berlyne 唤醒曲线]',
          'langs: [en, zh]',                      // unrecognized -- 596 entries in the real vault
          'lang: en',
          'owns: [arousal]',                      // unrecognized -- 32 wiki entries in the real vault
          'cssclasses: [wide]',                   // **stored** (the css_classes column) but not exported
          'excerpt: an inverted-U',               // **stored** (the excerpt column) but not exported
          '---',
          '',
          '# Berlyne',
          '',
          'arousal and preference.',
          '',
        ].join('\n'),
      }];

      const back = await roundTrip(request, vault);
      expect(back, 'a wiki note keeps every frontmatter key, in its own formatting')
        .toEqual(asMap(vault));

      await request.dispose();
    });

  // (3) -- layout must not be rewritten.
  test('a folder note that is alone in its folder stays in its folder',
    async ({ playwright }) => {
      const request = await playwright.request.newContext({ timeout: 120_000 });
      // The owner's convention is "a note lives in a same-named folder", even
      // when that folder holds only itself.
      // 22 entries in the real vault have this shape (raw/linguistics/linguistics.md, etc.).
      const vault: VaultFile[] = [{
        rel: 'raw/linguistics/linguistics.md',
        body: '---\nstatus: seed\n---\n\n# Linguistics\n\nalone in its folder.\n',
      }];

      const back = await roundTrip(request, vault);
      expect(Object.keys(back).sort(), 'the mirror does not restructure the vault')
        .toEqual(['raw/linguistics/linguistics.md']);

      await request.dispose();
    });
});

// ─── driver ────────────────────────────────────────────────────────────────────────────────

// roundTrip -- upload, then export back down. The export zip's keys are the
// vault-relative paths, so both sides are compared directly by key.
async function roundTrip(
  request: APIRequestContext, files: VaultFile[],
): Promise<Record<string, string>> {
  await uploadVault(request, OWNER, files, { authoritative: true });
  const zip = fflate.unzipSync(new Uint8Array(await downloadExport(request, OWNER)));
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(zip)) {
    if (!k.endsWith('/')) out[k] = new TextDecoder().decode(v);
  }
  return out;
}

function asMap(files: VaultFile[]): Record<string, string> {
  return Object.fromEntries(files.map((f) => [f.rel, f.body]));
}

function toVault(m: Record<string, string>): VaultFile[] {
  return Object.entries(m).map(([rel, body]) => ({ rel, body }));
}
