import { defineConfig } from 'tsup';

// @standmeet/sdk React 包装：复用 sdk-core 的 fetch + SSE，外层提供
// useStandMeetClient 上下文 hook 让 Next / 任意 React app 拿到客户端实例。
export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  dts: true,
  clean: true,
  external: ['react', 'react-dom'],
  treeshake: true,
  splitting: false,
});
