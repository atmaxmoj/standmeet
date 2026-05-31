// agent-core-package-invariants.spec.ts —— 防止 @standmeet/agent-core
// 退化的两条硬约束 (lint-grade)：
//
//   1) Bundle size < 200kb gz —— core 必须保持 thin (5 个 port + 状态
//      机)，加入 HTTP / DOM 依赖会立刻爆掉。
//
//   2) Purity: 0 个 fetch / fs / DOM / Node globals / 项目内 host pkg
//      import —— core 不知道运行环境是浏览器还是 Node；这是 DI 的
//      事实兜底，跟 eslint 规则两层防线。
//
// 这两条用 playwright 跑只是为了走通既有 e2e infra；本质是 file-system
// 检查。不需要 dev server / browser。

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

function assertBannedTokensAbsent(file: string, text: string): void {
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
