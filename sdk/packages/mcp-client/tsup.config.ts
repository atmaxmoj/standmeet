import { defineConfig } from 'tsup';

// @standmeet/mcp-client —— CLI that bridges Claude Desktop / Cursor stdio
// MCP transport to standmeet backend streamable HTTP. ESM-only。
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
  target: 'node22',
  platform: 'node',
});
