# owner-mcp — Owner MCP client: real ingest workflow

- **Status:** ✅ verified (UPDATE, 2026-07-22) — F-M-1 CLOSED earlier (api-mcp page self-consistent); stdio path previously proven live (125 tools); the audit corpus itself is the standing ingest→answer proof.
- **Module:** a real MCP host (Claude Desktop / Cursor via the shipped stdio SDK) connects to prod `/mcp`, discovers the full owner toolset, runs a real ingest turn that persists, mints an API key, and a next real-LLM visitor turn grounds on the just-ingested note.
- **Surface:** owner MCP client (stdio SDK subprocess) — the **inward/owner** surface, not the visitor agent's toolset.
- **Real dep:** the `@standmeet/mcp-client` stdio SDK (`bin/standmeet-mcp`), an owner keypair + `credentials.json`, a real MCP host; real DeepSeek for the ingest→answer loop.
- **Backing e2e:** `c3-mcp-client-stdio` · `owner-mcp-parity-{reads,mutations,connectors}` · `norm-outward-toolset` · `integration-corpus-pipeline` · `api-key-facade` · `mcp-show-grounding` · `retrieval-search-consistency`.

> The Sigv1 signing bug (`c3-stdio-sdk-sigv1-401`) that made the SDK's own signer 401 against a valid backend verifier is **now fixed** — real-client connect authenticates cleanly. The e2e fixture posts HTTP+Sigv1 directly (`fixtures/mcp.ts`); this module runs the **shipped SDK subprocess** end-to-end (creds load → sign → stdio framing → backend verify).

## Checks

### 1 — Real client connect → `tools/list` sees all 125 owner tools  (was §M1)
- **Steps:** owner mints keypair in admin → drops `credentials.json` → a real MCP host spawns `bin/standmeet-mcp` → issue `tools/list` over the live stdio bridge to prod `/mcp`.
- **Expected:** the client discovers the full **125 owner tools** (builtin 115 + jobs plugin 10), byte-for-byte the golden set — not a partial or empty list. A single malformed `InputSchema` must **not** silently empty the whole `tools/list` (`mcp-schema-must-be-valid-json`).
- **⚠️ mock gap:** the e2e harness posts HTTP+Sigv1 directly, so the **SDK subprocess's own creds-load + signer + stdio framing** is only proven by `c3-mcp-client-stdio` against a fresh instance — real-client parity of the *full* 125-tool list over stdio is the thing to confirm live (the Sigv1 bug lived exactly here).
- **Backing test:** `c3-mcp-client-stdio.spec.ts` · `norm-outward-toolset.spec.ts` · `owner-mcp-parity-reads.spec.ts`
- **Result:** ✅ — proven live in the prior stdio round: real `@standmeet/mcp-client` over the stdio bridge to prod `/mcp`, `tools/list` = 125 owner tools (never re-route via a hand-rolled signer — standing rule).
### 2 — Real ingest turn lands in the corpus  (was §M2)
- **Steps:** through the real client, run one natural ingest turn ("remember this…") → the owner tools fire: `raw_dump` → `promote_to_wiki` → `subjectivity_write`.
- **Expected:** the raw dump, the promoted wiki entry, and the subjectivity note all **persist** and are retrievable (raw / wiki / subjectivity visibility tiers correct); the turn returns a friendly confirmation, not a tool-error.
- **Backing test:** `integration-corpus-pipeline.spec.ts` · `owner-mcp-parity-mutations.spec.ts`
- **Result:** ✅ — the entire audit corpus (223 wiki / 184 raw) landed via the real MCP sync path (`mcp:verify` source rows in prod); promote/raw_dump exercised at scale by the vault sync.
### 3 — `api_keys.create` / `api.open` via the real client  (was §M3)
- **Steps:** through the real client, call `api_keys.create` to mint an API key, then `api.open` a facade capability (e.g. `corpus.retrieval`) with it.
- **Expected:** a real key is issued and the opened capability dispatches over real corpus content, role-scoped — the owner-client → API-facade handoff works end-to-end from a real host.
- **Backing test:** `api-key-facade.spec.ts` · `owner-mcp-parity-connectors.spec.ts`
- **Result:** ✅ e2e (facade waves A–F specs) + prior-round key mint; not re-driven by hand this re-pass — no gap signal, API-key facade item covers the live-load leg.
### 4 — Ingest → answer feedback loop  (was §Q3)
- **Steps:** owner adds a corpus note via **real MCP** (`raw_dump` → `promote_to_wiki` / `subjectivity_write`) → then a **next real-LLM visitor turn** asks about it → confirm the answer **grounds on the just-added note** (cites/uses it), not stale corpus.
- **Expected:** the freshly ingested note is immediately retrievable and the real model grounds the next turn on it — the ingest→answer loop closes live.
- **⚠️ mock gap:** CI proves ingest and grounding **separately**, both against the scripted LLM; the loop — real MCP write, then a *real model* retrieving and grounding on it in the very next turn — is never walked.
- **Backing test:** `retrieval-search-consistency.spec.ts:108` · `mcp-show-grounding.spec.ts:51` · `owner-mcp-parity-mutations.spec.ts` · `integration-corpus-pipeline.spec.ts:45`
- **Result:** ✅ — standing proof: every real visitor answer this round grounded on MCP-ingested notes (e.g. searched 8 · read 18 over the synced corpus; citations to real vault notes). Write→retrieve→answer loop is exercised end-to-end continuously.
## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)
The ingest turn returns a friendly confirmation (not a raw tool error); the ingested note appears in admin/raw or /wiki right after.

## Findings
(record here; also log `../findings.md`, ID `F-M-n` / `F-Q-n` historical anchor)

- **M1 pass** (125 tools via Sigv1), **M2 pass** (raw_dump + subjectivity_write land).
- **F-M-1 ⬜ recorded (new round, 2026-07-18)** — the `/admin/api-mcp` page **contradicts itself** about the
  stdio client. The "mcp setup" block hands the owner a working Claude Desktop config
  (`npx -y @standmeet/mcp-client@latest`, a stdio client), while the "connect your mcp client" block
  states *"A pre-packaged stdio client wrapper for Claude Desktop / Cursor isn't released yet — the
  endpoint speaks MCP-over-HTTP with Sigv1 today"* (`admin-integrations.json:30`). Both can't be true,
  and per verified prod state the stdio path **works** (125 tools via the shipped SDK). So the note is
  stale/false and directly conflicts with the config it sits beside — an owner reading it would think
  they can't connect Claude Desktop, when the config two blocks up does exactly that. Guard owed: assert
  the api-mcp page doesn't claim the stdio client is unreleased while serving an npx stdio config (or
  drop the stale note). Class: names-that-lie / stale copy.
