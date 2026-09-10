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
  // Stamp the client version from the build's STANDMEET_VERSION — the SAME git-tag source the server
  // uses (Makefile TAG -> --build-arg STANDMEET_VERSION -> ldflags). Empty on an unstamped local build,
  // which the code falls back from. This is what keeps the version-skew advisory meaningful: a matched
  // release (client tag == server tag) says nothing, only a real drift warns.
  define: {
    __MCP_CLIENT_VERSION__: JSON.stringify(process.env['STANDMEET_VERSION'] ?? ''),
  },
});
