# §M — Real MCP client (owner's ingest workflow)

- **Status:** ⬜ not-run
- **Scope:** runnable-now — the SDK client ships in-repo; no external credential needed.
- **Prereqs/creds:** the `@standmeet/mcp-client` stdio SDK (`sdk/packages/mcp-client`, `bin/standmeet-mcp`). Owner mints a keypair in admin → writes `credentials.json` → a real MCP host (Claude Desktop / Cursor, or a manual spawn) launches `node …/bin/standmeet-mcp` as a stdio subprocess that signs (Sigv1) and bridges to the prod `/mcp`. **Note:** the Sigv1 signing bug (`c3-stdio-sdk-sigv1-401`) that made the SDK's own signer 401 against a valid backend verifier is **now fixed** — so real-client connect should authenticate cleanly.
- **Real service:** a **real MCP client** (Claude Desktop / Cursor via the stdio SDK) hitting prod `/mcp` over the real client's transport + real request signing, replacing the e2e `fixtures/mcp.ts` HTTP+Sigv1 direct-post harness.
- **Backing e2e:** (attribution targets) `c3-mcp-client-stdio` · `owner-mcp-parity-{reads,mutations,connectors}` · `norm-outward-toolset` · `integration-corpus-pipeline` · `api-key-facade`

> **Two MCP surfaces — this is the inward/owner one.** §M drives the **owner client MCP** (`ownercore`: `raw_dump`, `promote_to_wiki`, `api_keys.create`, …), not the visitor agent's own toolset. The e2e fixture posts HTTP+Sigv1 directly; §M instead runs the **shipped SDK subprocess** end-to-end (creds load → sign → stdio framing → backend verify), the path a real owner actually uses.

## Sub-items

### M1 — Real client connect → `tools/list` sees all 125 owner tools
- **Steps:** owner mints keypair in admin → drops `credentials.json` → a real MCP host spawns `bin/standmeet-mcp` → issue `tools/list` over the live stdio bridge to prod `/mcp`.
- **Expected:** the client discovers the full **125 owner tools** (builtin 115 + jobs plugin 10 per `norm-outward-toolset.spec.ts:16`), byte-for-byte the golden set — not a partial or empty list. A single malformed `InputSchema` must **not** silently empty the whole `tools/list` (the failure mode `mcp-schema-must-be-valid-json` guards against).
- **⚠️ mock gap:** the e2e harness posts HTTP+Sigv1 directly (`fixtures/mcp.ts`), so the **SDK subprocess's own creds-load + signer + stdio framing** is only proven by `c3-mcp-client-stdio` against a fresh instance — real-client parity of the *full* 125-tool `tools/list` over stdio is the thing to confirm live (the Sigv1 bug lived exactly here).
- **Backing test:** `c3-mcp-client-stdio.spec.ts` (stdio subprocess, `me` tool) · `norm-outward-toolset.spec.ts` (the 125-tool golden) · `owner-mcp-parity-reads.spec.ts`
- **Result:** ⬜

### M2 — Real ingest turn lands in the corpus
- **Steps:** through the real client, run one natural ingest turn ("remember this…") → the owner tools fire: `raw_dump` → `promote_to_wiki` → `subjectivity_write`.
- **Expected:** the raw dump, the promoted wiki entry, and the subjectivity note all **persist** and are retrievable afterward (raw / wiki / subjectivity visibility tiers correct); the turn returns a friendly confirmation, not a tool-error.
- **Backing test:** `integration-corpus-pipeline.spec.ts` · `owner-mcp-parity-mutations.spec.ts`
- **Result:** ⬜

### M3 — `api_keys.create` / `api.open` via the real client
- **Steps:** through the real client, call `api_keys.create` to mint an API key, then `api.open` a facade capability (e.g. `corpus.retrieval`) with it.
- **Expected:** a real key is issued and the opened capability dispatches over real corpus content, role-scoped — the owner-client → API-facade handoff works end-to-end from a real host.
- **Backing test:** `api-key-facade.spec.ts` · `owner-mcp-parity-connectors.spec.ts`
- **Result:** ⬜

## Findings
(record here during the manual phase; also log `../findings.md`, ID `F-M-n`)
