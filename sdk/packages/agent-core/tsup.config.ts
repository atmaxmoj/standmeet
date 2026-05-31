import { defineConfig } from 'tsup';

// @standmeet/agent-core 是 visitor chat agent loop 的纯 TS 核。
// 不引 HTTP / fs / DOM / Node API — 行为由 caller 注的 5 个 port 决定。
// 同 code 同 system prompt 在 prod browser / Node eval harness / 任何 host 跑。
export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: false,
  treeshake: true,
  splitting: false,
});
