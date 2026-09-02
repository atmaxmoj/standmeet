// agent-core-package-invariants.spec.ts — two hard constraints (lint-grade)
// that prevent @standmeet/agent-core from degrading:
//
//   1) Bundle size < 200kb gz — core must stay thin (5 ports + a state
//      machine); adding an HTTP / DOM dependency blows this up instantly.
//
//   2) Purity: zero fetch / fs / DOM / Node globals / in-project host pkg
//      import — core doesn't know whether it's running in a browser or
//      Node; this is the factual backstop for DI, a second line of defense
//      alongside the eslint rule.
//
// These two run via playwright only to reuse the existing e2e infra; they
// are file-system checks in essence. No dev server / browser needed.

import { test, expect } from '@/fixtures/test';
import { readFileSync, statSync, readdirSync } from 'fs';
import { join } from 'path';
import { gzipSync } from 'zlib';

const AGENT_CORE_DIR = join(
  process.cwd(), '..', 'sdk', 'packages', 'agent-core',
);

test.describe('agent-core · package invariants (lint-grade)', () => {
  test('built bundle is under 200kb gzipped (thin core)', () => {
    const distFile = join(AGENT_CORE_DIR, 'dist', 'index.js');
    // ensure dist exists — caller should `make sdk-build` first
    const size = statSync(distFile).size;
    expect(size, 'raw dist size sanity check').toBeGreaterThan(100);
    const gz = gzipSync(readFileSync(distFile));
    const kb = gz.byteLength / 1024;
    expect(kb, `bundle ${kb.toFixed(2)}kb > 200kb cap`).toBeLessThan(200);
  });

  test('src/ contains no banned HTTP/DOM/Node globals or imports', () => {
    const srcDir = join(AGENT_CORE_DIR, 'src');
    const files = readdirSync(srcDir).filter(f => f.endsWith('.ts'));
    expect(files.length, 'at least one source file').toBeGreaterThan(0);
    for (const f of files) {
      const text = readFileSync(join(srcDir, f), 'utf8');
      assertBannedTokensAbsent(f, text);
    }
  });

  test('src/ does not import from any standmeet host package', () => {
    const srcDir = join(AGENT_CORE_DIR, 'src');
    const files = readdirSync(srcDir).filter(f => f.endsWith('.ts'));
    for (const f of files) {
      const text = readFileSync(join(srcDir, f), 'utf8');
      // agent-core is a leaf — it must not depend on host pkgs.
      expect(text, `${f}: must not import @standmeet/sdk`).not.toMatch(/@standmeet\/sdk\b/);
      expect(text, `${f}: must not import @standmeet/sdk-core`).not.toMatch(/@standmeet\/sdk-core/);
      expect(text, `${f}: must not import @standmeet/embed`).not.toMatch(/@standmeet\/embed/);
    }
  });
});

// stripComments — strips line / block comments so the banned-token scan only sees
// real code. Prose mentioning "document" (e.g. in a DocContext comment) shouldn't
// count as a violation; an actual document.x use still gets caught. The line-comment
// pattern guards with (^|[^:]) to avoid stripping the "://" of a URL inside a string.
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function assertBannedTokensAbsent(file: string, raw: string): void {
  const text = stripComments(raw);
  const bannedGlobals = [
    'window', 'document', 'fetch(',
    'localStorage', 'sessionStorage', 'navigator',
    'process.env', 'process.cwd',
  ];
  for (const tok of bannedGlobals) {
    expect(text, `${file}: must not reference ${tok}`).not.toContain(tok);
  }
  const bannedImports = [
    /from\s+['"]node:/,
    /from\s+['"]fs['"]/,
    /from\s+['"]fs\//,
    /from\s+['"]path['"]/,
    /from\s+['"]http['"]/,
    /from\s+['"]https['"]/,
    /from\s+['"]stream['"]/,
  ];
  for (const re of bannedImports) {
    expect(text, `${file}: must not match ${re.source}`).not.toMatch(re);
  }
}
