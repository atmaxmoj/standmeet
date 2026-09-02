import { defineConfig } from 'tsup';

// @standmeet/embed — Web Components wrapper. For non-React sites: one <script>
// tag, and <standmeet-chat handle="alice">…</standmeet-chat> mounts in the DOM.
// Built on sdk-core (no React dependency); the React UI is too heavy, so this is hand-written vanilla DOM.
export default defineConfig({
  entry: { embed: 'src/embed.ts' },
  format: ['esm', 'iife'],
  globalName: 'StandMeetEmbed',
  dts: true,
  clean: true,
  treeshake: true,
  splitting: false,
});
