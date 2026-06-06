import { defineConfig } from 'tsup';

// @standmeet/eval-harness —— Node CLI; not a browser bundle.
// 跟 prod 共用 @standmeet/agent-core (一字不差跑 VisitorAgent 5-port loop)；
// 私有 src/adapters/ 注 fs / canned / direct-LLM / print 实现。
export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  dts: true,
  clean: true,
  sourcemap: false,
  treeshake: true,
  splitting: false,
});
