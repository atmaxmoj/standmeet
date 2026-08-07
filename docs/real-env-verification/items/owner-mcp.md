# owner-mcp — Owner MCP client: real ingest workflow

- **Module:** A real MCP host connects to the instance through the shipped stdio client, discovers the full owner toolset, runs an ingest turn that persists, mints an API key, and a following visitor turn grounds on the note that was just ingested.
- **Surface:** The owner's MCP client, spawned as a subprocess by a real host. This is the inward owner surface, not the visitor agent's toolset — see [[two-mcp-surfaces]].
- **Real dep:** The shipped stdio client binary, an owner keypair with its credentials file, a real MCP host, and a real model for the ingest-to-answer loop.
- **Backing e2e:** `c3-mcp-client-stdio` · `owner-mcp-parity-{reads,mutations,connectors}` · `norm-outward-toolset` · `integration-corpus-pipeline` · `api-key-facade` · `mcp-show-grounding` · `retrieval-search-consistency`.

## Checks

### 1 — The real client connects and sees the whole toolset ⭐
- **Steps:** Mint a keypair in admin. Place the credentials file. Let a real host spawn the client. Issue a tool listing over the live bridge. Count the tools and compare against the golden set.
- **Expected:** The full owner toolset appears, matching the golden set exactly — not a partial list and not an empty one. A single malformed tool schema must not empty the whole listing.
- **Mock gap:** The e2e harness posts signed HTTP directly, so the shipped client's own credential loading, signing and stdio framing are only covered against a fresh instance. Parity of the full list over the real bridge is the thing to confirm live, and the signer is exactly where a past defect lived.
- **Backing test:** `c3-mcp-client-stdio.spec.ts` · `norm-outward-toolset.spec.ts` · `owner-mcp-parity-reads.spec.ts`
- **Note:** Never route around the shipped client with a hand-rolled signer to make a check pass. That hides the defect the check exists to find.

### 2 — An ingest turn persists across every genre
- **Steps:** Through the real client, run one natural ingest turn. Let the tools fire: dump a raw note, promote it, write a subjectivity note. Then retrieve each one.
- **Expected:** All three persist and are retrievable, each with the right visibility. The turn returns a friendly confirmation, not a tool error.
- **Backing test:** `integration-corpus-pipeline.spec.ts` · `owner-mcp-parity-mutations.spec.ts`

### 3 — Key minting and facade opening work from a real host
- **Steps:** Through the real client, mint an API key. Open a facade capability with it. Dispatch a call over real corpus content.
- **Expected:** A real key is issued, the capability opens, and the call returns real rows scoped to the key.
- **Backing test:** `api-key-facade.spec.ts` · `owner-mcp-parity-connectors.spec.ts`

### 4 — A note written through MCP grounds the very next answer ⭐
- **Steps:** Add a note through the real client containing a distinctive fact. Immediately ask a visitor question that only that note answers. Read the answer and its citations.
- **Expected:** The fresh note is retrievable at once and the model grounds on it, citing it.
- **Mock gap:** CI proves ingest and grounding separately, both against a scripted model. The loop — a real write, then a real model retrieving it on the next turn — is never walked.
- **Backing test:** `retrieval-search-consistency.spec.ts` · `mcp-show-grounding.spec.ts`

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)

The ingest turn returns a friendly confirmation, never a raw tool error.
The ingested note appears on the admin surface immediately after, without a reload being needed to prove it landed.
The tool count the client reports is a number worth reading — a listing that silently shrinks is how a schema error hides.
