// openapi-mcp.js — the google-calendar block wrapper. Google Calendar is DATA (spec.yaml +
// binding.yaml in this dir); the behavior is the shared generic openapi-runtime engine. The engine
// reads this dir's spec/binding and exposes the calendar seam's verbs (free_busy / insert_event /
// delete_event / verify) as tools. Any owner-uploaded openapi supplier is the same two lines.
const { serve } = require('standmeet-openapi-mcp')

serve(__dirname).catch((e) => {
  console.error(e) // stderr only — stdout is the JSON-RPC channel
  process.exit(1)
})
