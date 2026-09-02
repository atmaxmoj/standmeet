// vault-roundtrip-noop.spec.ts — **sync up, sync down, with no edits in between → the
// vault must not change by a single byte.**
//
// Why this case exists: this product sells the vault as a **mirror**. And an owner's
// vault is typically a git repo (the real one is: 1081 md files, 48 MB, with a .git).
// So "the files differ after a round trip" isn't an abstract purity concern — it looks
// like this: every sync produces hundreds of diffs in git, even though the owner
// never touched a single character. From that point on they can't use `git status`
// to answer "what did I change" — which is exactly one of the reasons they keep a
// vault in the first place.
//
// The existing `sync-j-export.spec.ts` has a case called roundtrip, but it **declares
// for itself that it does not check byte equality**: "Byte-equality is the wrong bar
// (frontmatter is reconstructed, key order is not preserved)", and its criterion is
// weakened to `toContain(original prose)` plus equal path sets. Which means "the
// round trip rewrote the file" is something it structurally cannot detect — it's
// green in exactly the same shape whether the file was rewritten or not
// ([[verifier-can-lie-about-its-own-coverage]]).
//
// So this case asks two separate questions, and when their answers differ the
// meaning is entirely different:
//
//   ① One round trip: does what comes out == what went in? — this is literally the
//      question the owner is asking.
//   ② Two round trips: does the second output == the first output? — **convergence**.
//      ① red and ② green  = the first sync rewrites your library once, then settles
//      (a one-time migration cost).
//      ① red and ② also red = every single sync produces a diff, forever. That's a
//      defect of a different order.
//
// What's fed in is a **real vault**, not a synthetic one: frontmatter conventions,
// Chinese-language titles, attachment references, directory depth — a synthetic
// fixture cannot pick out these shapes, and rewriting happens exactly on these shapes
// ([[stand-in-is-politer-than-reality]]).
// If no real vault is present, skip — and **say so out loud**: a silently skipped
// case looks identical to a pass.

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';

import * as fflate from 'fflate';
import type { APIRequestContext } from '@playwright/test';

import { test, expect } from '@/fixtures/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { uploadVault, downloadExport, type VaultFile } from '@/fixtures/obsidian';

const OWNER = {
  email: 'vault-roundtrip@example.com', password: 'correct-horse-battery-staple',
  handle: 'vaultroundtrip', fullName: 'Vault Roundtrip Owner',
};

// VAULT_DIR — the owner's actual vault. Can be pointed elsewhere with REAL_VAULT
// (the path differs on another machine).
const VAULT_DIR = process.env['REAL_VAULT'] ?? join(homedir(), 'Develop/writing/notes');

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('vault mirror · a round trip with no edits', () => {
  test.beforeAll(async ({ playwright }) => {
    // This spec pours over a thousand notes into the database, so the next reset's
    // TRUNCATE runs slower than the default 30s hook limit. What's being relaxed is
    // the hook's patience — the criterion has not changed at all.
    test.setTimeout(180_000);
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
  });

  test('sync up then sync down returns the same bytes, and a second round changes nothing',
    async ({ playwright }) => {
      test.skip(!existsSync(VAULT_DIR), `no vault at ${VAULT_DIR} — set REAL_VAULT to point at one`);
      // Two rounds against a real vault (measured at ~17s per round, a thousand
      // notes) don't fit in the default 30s. Same as above: what's relaxed is
      // patience.
      test.setTimeout(300_000);
      // Importing a thousand notes naturally takes tens of seconds, and
      // Playwright's API default cap is 10 seconds — that number belongs to the
      // driver, not the product: the browser has no such cap when the owner clicks
      // "import" in the UI. What's relaxed is the driver's patience, not the
      // criterion (the criterion has not changed at all: the bytes must match).
      const request = await playwright.request.newContext({ timeout: 300_000 });

      const original = readVault(VAULT_DIR);
      expect(original.length, `${VAULT_DIR} has notes to sync`).toBeGreaterThan(0);
      console.log(`\n── vault: ${original.length} files from ${VAULT_DIR}`);

      const first = await timed('round 1', () => roundTrip(request, original));
      const second = await timed('round 2', () => roundTrip(request, exportedAsVault(first)));

      // **Print both reports before asserting anything**. If an assertion stops the
      // run the moment it goes red, whoever reads the output only gets one of the two
      // answers — and "what the first round trip changed" only makes sense read
      // together with "does the second round still change anything".
      const once = diff(original, first);
      const twice = diff(exportedAsVault(first), second);
      report('一次往返（原样返回）', once);
      report('二次往返（收敛）', twice);

      // ① The exact question the owner is asking. What's checked is the three
      // corpus genres (raw / wiki / subjectivity) — on this real vault run, that's
      // 1077 out of 1078 files.
      //
      // The two excluded categories each **have a name and a reason**, not "close
      // enough":
      //   · `writings/` — goes through a separate export path (a domain entity +
      //     its own mapper), which likewise drops `langs` / `aliases-zh` and adds
      //     `slug` / `cover_hue` out of nowhere. F-L-70, not yet fixed.
      //   · `.obsidian/` — harvested at import time (appearance + snippets CSS),
      //     but export never writes it back. F-L-71, not yet fixed.
      //   · `templates/` — **correctly dropped**: it isn't a genre directory, and
      //     was never supposed to enter the corpus.
      // Any new item added to this list must have its reason spelled out here; it
      // isn't there to absorb whatever new differences show up.
      expect(
        summarise(withoutKnownGaps(once)),
        'sync up then down with no edits must return the vault byte-for-byte',
      ).toEqual({ changed: 0, missing: 0, added: 0 });

      // ② Convergence. This assertion **carries no exceptions whatsoever**: even if
      // some category gets rewritten on the first round, the second round must be a
      // fixed point — failure to converge means every sync produces a diff, forever.
      expect(
        summarise(twice),
        'a second round trip must be a fixed point — otherwise every sync produces a diff forever',
      ).toEqual({ changed: 0, missing: 0, added: 0 });

      await request.dispose();
    });
});

// ─── driving ─────────────────────────────────────────────────────────────────────────────

// timed — reports how long it took, as a side effect. How long a thousand-note round
// trip takes is the next question an owner will ask, and it's only knowable by
// actually running it.
async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  const out = await fn();
  console.log(`── ${label}: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return out;
}

// roundTrip — upload, then export back down. The exported zip's contents are keyed
// by genre-relative path, aligned with paths relative to the vault.
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

// The exported zip's keys **already are the paths relative to the vault**
// (`raw/cognitive-science/cognitive-science.md`), with no extra vault prefix — so
// the two sides can be compared directly by key.
//
// ⚠️ The first draft stripped a prefix layer right here (copying sync-j-export's
// `stripVaultPrefix`), which stripped off the **genre directory** instead: the
// report read "1082 missing · 1052 added · 0 changed", which looked like the
// product had moved the entire library elsewhere. The truth was that the harness was
// talking to itself. When a new guard goes red for the first time, suspect the guard
// first ([[read-the-failure-before-theorising]]).
function exportedAsVault(exported: Record<string, string>): VaultFile[] {
  return Object.entries(exported).map(([rel, body]) => ({ rel, body }));
}

// ─── reading the real vault ──────────────────────────────────────────────────────────────

// readVault — filters via **the product's own path** (use-obsidian.ts's
// syncableVaultFiles / the server's sync_classify.go): non-hidden .md files, plus the
// harvested .obsidian configuration. Writing an independent filtering scheme here
// would mean comparing against a different set than the one the product actually
// syncs.
function readVault(root: string): VaultFile[] {
  const out: VaultFile[] = [];
  walk(root, root, out);
  return out;
}

function walk(root: string, dir: string, out: VaultFile[]): void {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    const rel = relative(root, abs);
    if (statSync(abs).isDirectory()) {
      if (!isHiddenSeg(name) || name === '.obsidian') walk(root, abs, out);
      continue;
    }
    if (syncable(rel)) out.push({ rel, body: readFileSync(abs, 'utf8') });
  }
}

function isHiddenSeg(seg: string): boolean {
  return seg === '_templates' || seg.startsWith('.');
}

function syncable(rel: string): boolean {
  const harvested = rel.endsWith('.obsidian/appearance.json')
    || (rel.includes('.obsidian/snippets/') && rel.endsWith('.css'));
  if (harvested) return true;
  return rel.endsWith('.md') && !rel.split('/').some(isHiddenSeg);
}

// ─── criteria ────────────────────────────────────────────────────────────────────────────

interface Diff {
  changed: { rel: string; before: string; after: string }[];
  missing: string[];
  added: string[];
}

function diff(before: VaultFile[], after: Record<string, string>): Diff {
  const d: Diff = { changed: [], missing: [], added: [] };
  const seen = new Set<string>();
  for (const f of before) {
    seen.add(f.rel);
    const got = after[f.rel];
    if (got === undefined) d.missing.push(f.rel);
    else if (got !== f.body) d.changed.push({ rel: f.rel, before: f.body, after: got });
  }
  d.added = Object.keys(after).filter((k) => !seen.has(k));
  return d;
}

// KNOWN_GAPS — the two categories not yet fixed, each pointing at a specific
// finding. Any difference outside these three must go red.
const KNOWN_GAPS = [
  'writings/',   // F-L-70: writings goes through a separate export path, not yet
                 // wired into the fidelity mechanism
  '.obsidian/',  // F-L-71: harvested Obsidian config, never written back on export
  'templates/',  // not a genre directory — dropping it is **correct**; listed here
                 // only so it isn't counted as a difference
];

function withoutKnownGaps(d: Diff): Diff {
  const open = (p: string): boolean => !KNOWN_GAPS.some((g) => p.startsWith(g));
  return {
    changed: d.changed.filter((c) => open(c.rel)),
    missing: d.missing.filter(open),
    added: d.added.filter(open),
  };
}

function summarise(d: Diff): { changed: number; missing: number; added: number } {
  return { changed: d.changed.length, missing: d.missing.length, added: d.added.length };
}

// report — when it's red, it must let someone **act immediately**: a bare count
// can't say which line changed. Prints the first differing line for each of the
// leading categories.
// An assertion that only says "not equal" leaves the reader with no next step but to
// re-run it themselves to investigate ([[read-the-failure-before-theorising]]).
function report(label: string, d: Diff): void {
  if (d.changed.length + d.missing.length + d.added.length === 0) return;
  const lines = [`\n── ${label}: ${d.changed.length} changed · ${d.missing.length} missing · ${d.added.length} added`];
  // Unfold one sample per genre. Unfolding only the first would let raw, coming
  // first, bury wiki's shape entirely — and the two change in completely different
  // ways (one is additive, the other is frontmatter reordering); treating them as
  // one thing would miss half the picture.
  for (const genre of ['raw', 'wiki', 'subjectivity', 'writings']) {
    const head = d.changed.find((c) => c.rel.startsWith(`${genre}/`));
    if (head === undefined) continue;
    lines.push(`  ~ [${genre}] ${head.rel} — 头 12 行两边并排:`);
    lines.push(`    IN :\n${indent(head.before)}`);
    lines.push(`    OUT:\n${indent(head.after)}`);
  }
  // missing / added are **listed in full**, never truncated: they're path-level
  // facts and there are never many of them, and the number "26 missing" on its own
  // gives nobody anything to act on. Only changed needs truncation (it can run into
  // the thousands).
  for (const m of d.missing) lines.push(`  - ${m} (went in, did not come back)`);
  for (const a of d.added) lines.push(`  + ${a} (came back, never went in)`);
  console.log(lines.join('\n'));
}

// indent — the first 12 lines (frontmatter blocks usually live inside this range).
// Giving only a single delta line would leave the reader with no next step but to
// re-run it themselves to see the context.
function indent(s: string): string {
  return s.split('\n').slice(0, 12).map((l) => `      ${JSON.stringify(l)}`).join('\n');
}

