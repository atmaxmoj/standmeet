import { defineConfig } from 'tsup';

// @standmeet/sdk-core 是无 UI 的核心：API client、类型、状态机。
// ESM-only、.d.ts 输出、tree-shake 开、splitting 关 —— dist/ 保持扁平，
// package.json 的 exports map 简洁。
export default defineConfig({
  entry: {
    index: 'src/index.ts',
  },
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: false,
  treeshake: true,
  splitting: false,
});
