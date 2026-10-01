// openapi-mcp.js — the shared openapi block: the runtime every owner-uploaded openapi supplier (and
// the built-in bearer-api) runs on. This dir ships no spec.yaml, so each call brings its supplier's
// spec + binding (merged in by the host) and the engine serves every seam verb plus raw_call.
const { serve } = require('./engine.js')

serve(__dirname).catch((e) => {
  console.error(e) // stderr only — stdout is the JSON-RPC channel
  process.exit(1)
})
