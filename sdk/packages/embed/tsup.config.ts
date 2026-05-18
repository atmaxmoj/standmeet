import { defineConfig } from 'tsup';

// @standmeet/embed —— Web Components 包装。给非 React 站点用：一个 <script>
// 引入，DOM 里 <standmeet-chat handle="sijie">…</standmeet-chat> 就能挂载。
// 内部走 sdk-core（无 React 依赖）；React UI 太重，这里手写 vanilla DOM。
export default defineConfig({
  entry: { embed: 'src/embed.ts' },
  format: ['esm', 'iife'],
  globalName: 'StandMeetEmbed',
  dts: true,
  clean: true,
  treeshake: true,
  splitting: false,
});
