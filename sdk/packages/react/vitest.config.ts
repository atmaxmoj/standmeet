// vitest.config.ts —— unit tests for the chat engine's pure parts (refactor ledger R21). The e2e
// suite stays the primary coverage; these are the fast local check on the state machine every
// surface renders. Node environment: nothing here needs a DOM.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
