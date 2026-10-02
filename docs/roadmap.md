# StandMeet Roadmap — major blocks

> **Perspective:** This document covers only **major blocks** — "the next big thing to build". Fine-grained items live in the task tracker and are not repeated here.
> **Sources:** Combines `~/Develop/writing/notes/wiki/software/project/standmeet/` (the owner's design vault) + the actual state of the code. Many seeds in the vault **have no landed design themselves** (some are marked 🚧, some are not), so before starting each major block we must, as we did for connectors, **first produce a design + tests**, then write code.
> **Status legend:** ✅ built · 🟡 partly built · ⬜ not built · 🚧 = marked in the vault as "design in flight, not landed".

---

## Block 1 · corpus = Obsidian vault (the core product promise; the largest and most scattered)

In one sentence: **the owner writes in Obsidian → StandMeet syncs → StandMeet is another renderer of this portable markdown, serving the curated graph to visitors.** This directly delivers the product hub's "author in Obsidian, sync to StandMeet", the thesis (AI conversation → curated corpus), and the differentiation ("a personal site, but conversational" + the graph the owner wove by hand = relevance signal).

The corpus data shape **already is a vault**: three-level promotion (raw→wiki→output), derived-path (parent_id tree, reparenting is free, no path column), backlinks as a declaratively rebuilt edge table (`wiki_refs`/`writing_refs`). So Block 1 is not "rebuild the corpus"; it is "**complete the vault's three faces (feeding the graph / crawling the graph / rendering)**".

### 1a · Sync side (feeding the graph) ✅ mechanism complete (rewritten in 2026-09 as multi-genre sync, replacing the original writings-only minimal version)
- ✅ **Multi-genre `SyncVault`**: the vault's top-level folders route by genre into the `corpus_notes` node tree (`backend/internal/corpus/obsidian/sync.go`, `corpGenres = {wiki, subjectivity}` + raw). The writings layer additionally has manual bulk export (zip)/import. **output has no matching folder** — it is promote-derived, not fed from the vault; that is by design, not a gap.
- ✅ **Folder-note collapsing is implemented**: `basename(file)==basename(dir)` → that file is a folder note, node path = the directory path (`sync_tree.go` `nodePathFor`); missing folder notes in intermediate segments get an empty placeholder automatically.
- ✅ **Open question answered**: wiki `parent_id` is derived from the vault folder tree (folder tree → node path, same `nodePathFor`).
- Coverage: sync-a…sync-k / sync-authoritative-prune / sync-e-links / note-refs-unified and other e2e; the only self-acknowledged gap = aligning the importer with the vault's own scripts (`#107` manual verification against the real local vault).
- Related specific items: `#151` (raw grading/hierarchy), `#113` (`seo_indexed`→`published`, aligned with the vault's `publish` gate), `#114` (split out landing/reader).

### 1b · Retrieval side (crawling this graph) ✅
- ✅ `corpus_search`/`_read`/`_list` over Postgres full-text search; `corpus_map` navigation **crawls only the tree** (parent_id).
- ✅ **Graph crawling (graph retrieval) = agent-driven, by design**: `corpus_links` gives a node's 1-hop outgoing edges + incoming edges (backlinks), each neighbor passes through ACL (`corpus/usecase/corpus_lister_pg_links.go` `Links()`); the agent follows `[[links]]` deeper one hop at a time on its own (stated explicitly in the block instructions `retrieval-mcp.js:27-31`). Multi-hop traversal is left to the agent's reasoning; it is not a gap.
- **Decision (2026-09-18): do not build a server-side single-pass walk/rank**. Relevance ranking = reasoning, which belongs to the agent; same origin as 1b's "no vectors, relevance = links the owner wrote"; the server ranking for the agent = going backwards. See the decision record [`docs/design/corpus-graph-retrieval.md`](corpus-graph-retrieval.md) (only if visitor chat round-trip latency really bites would we consider a purely deterministic walk = option ②, still without ranking).
- **Decision made**: **deliberately no vector/pgvector** — relevance = the `[[links]]` the owner wrote, not a semantic distance guessed by a model.
- Landing design still to add: BFS depth/ranking caps, how ACL enters the query (don't crawl into entries the role cannot see), how to merge with full-text search.
- Related: `#150` (output backlinks — output/writings need an edge table like wiki, so the graph can connect).

### 1c · Rendering symmetry (both sides from the same source) 🟡
- ✅ KaTeX + Mermaid (D-6).
- ✅ **Callout `> [!theorem]`**: `markdown-callouts.ts` (a hand-written mdast walk, without pulling in unist-util-visit) turns a `> [!type] Title` blockquote into `blockquote.callout[data-callout=type]` + `.callout-title` (DOM aligned with Obsidian); wired into the ChatMarkdown pipeline (wiki/output/restricted); `data-callout` is on the rehype-sanitize allowlist; the `.callout` base style uses the design palette and the owner can override it per type. **Verified by screenshot** (theorem / warning callout boxes render correctly).
- ✅ **TikZ precise math diagrams**: ` ```tikz ` → node-tikzjax (= the same engine as obsidian-tikzjax, consistent on both sides) renders SVG on the server, the client fetches lazily (the heavy WASM stays out of the client bundle). serverExternalPackages + outputFileTracingIncludes bring the TeX runtime assets (core.dump.gz etc.) into standalone; 25s fail-fast degradation. **RED→GREEN** (render-tikz).
- ✅ **`standmeet-widget` sandboxed iframe block (v1)**: a JSON descriptor (src/height/sandbox) inside a fenced block → sandboxed `<iframe>`; sandbox defaults to the minimal `allow-scripts` (no allow-same-origin); mount-guard → `seo:false` (mounted on the client only, not in SSR/indexing); malformed input degrades. **RED→GREEN** (render-widget). **postMessage protocol (render-data/resize/requestCapability) + per-block ACL are deferred** — left for a separate design round (unified with the MCP Apps `ui://` renderer).
- ✅ **Sync the owner's Obsidian CSS snippets** (owner decision 2026-07, **changing the original "never import CSS" design**): `.obsidian/snippets/<enabled>.css` is synced in as StandMeet page CSS, so "both sides look exactly the same". All three points landed: (a) vault-ingestion opens a harvest allowlist for `.obsidian/snippets/*.css` + `appearance.json` (no longer "ignore every dot prefix"); (b) **sanitize** — strip `@import`/external+js `url()`/`expression()`/`-moz-binding`, and scope every selector to `.corpus-content`; (c) three surfaces (vault-sync / admin PUT `/appearance/css` / MCP `set_owner_css`) write the same `owners.custom_css`; **plus a per-note `cssclasses` frontmatter presentation hook** (written by the three surfaces, returned by corpus_read). owner-css-* / cssclasses-surfaces / sync-g-hidden all green.
  **Real rendering is wired (only this counts as done, not just a green backend)**: the public `GET /api/v1/appearance.css` (text/css) is referenced by the reader's `<link>` (a real stylesheet resource, not an inline `<style>`); `CorpusContent` has two layers — `.corpus-content` as the scope anchor, per-note cssclasses on an inner div (so the owner's `.theorem{…}`, scoped to `.corpus-content .theorem`, can match). All four reader surfaces wiki/output/writings/restricted are wired. **Each one checked by screenshot** (owner snippet changing h2/blockquote/code, `.boxed` drawing a box, callout). The earlier ✅ was marked early when only backend store/read existed and frontend rendering was not wired; rendering is now complete.

### 1d · Leveraging the Obsidian ecosystem (don't host plugins; borrow their output/code/signals) ⬜
**Obsidian plugins cannot run inside StandMeet** (the closed-source Electron host = that wall; even Obsidian's own Publish cannot run plugins). But the ecosystem's value comes in by three routes:
- **Authoring helpers** (Templater/QuickAdd) → not needed — they only run while writing and leave plain markdown behind, which we ingest directly.
- **Rendering** (KaTeX/Mermaid/TikZ) → **don't use the plugins; use the underlying libraries directly** (see 1c).
- **Dataview-like (query) → build it natively, and stronger**: the corpus already is a real DB (Postgres) + frontmatter + `wiki_refs`, so it can run Dataview-style queries, stronger than Dataview-over-files. ✅ **"Corpus query" is built**: a ` ```standmeet-query ` fenced block in the note body (genre/tag/children-of/sort/limit DSL) is resolved server-side at corpus_read time into a live `[[Title]]` list, ACL by construction (uses the reader's own grantedGlobs; owner-only genres do not leak). query-render / query-acl / query-errors all green.
- **When a plugin is truly needed → owner-side export pre-rendering** (the Dataview Publisher / Digital Garden approach, baking the dynamic parts into static markdown); StandMeet ingests the baked result. This is also exactly Obsidian Publish's own solution (a browser app that only runs core rendering + `publish.css`).
- **Execute Code (Jupyter-style)**: runs as usual on the owner side; to show code+output → store the output in the note, then ingest; **for live execution on the served page → reuse StandMeet's own hardened sandbox** (`skill_run_script`/`internal/sandbox`: bwrap + `--network=none` + allowlist); don't copy Execute Code's "local machine, no sandbox" model (#5 isolation).

### 1e · The shape of sync (current state vs design) 🟡
- 🟡 Today it is a **bespoke endpoint** (`routes/admin/obsidian.go`, two buttons export/import), independent of connectors.
- The design (decision point **P.9**) says: **connectors have two modes, action / sync, under one abstraction; "Obsidian = sync"**. → In future the vault sync can be **unified into a sync-mode connector** (the same connector substrate as calendar/mail, ingest instead of action). Whether to unify is the **seam** between Block 1 and Block 2.
- Related: `#107` (manual verification against your **real local vault**), `#108` (verification plan for real external services — the kind that cannot be e2e).

> **Block 1 summary**: the data (tree + edges) is all in place, and the decisions (non-vector / portable / per-host but optional owner CSS sync / don't host plugins, borrow their output) are all settled; **the risk is local and does not ripple through everything**.

---

## Block 2 · Platform architecture #135 (three layers: A–H mechanism / "replacement" migration / driver)

End state (design doc): **core = corpus + visitor chat + AccessCode + PDF + AI provider + one plugin loader, zero capabilities**; `MustRegister` + the in-process registry are **all deleted**; every capability migrates into an independent standard MCP server. View this block as **three layers**, and don't mix them:

### Layer ① · Phase A–H (mechanism) — basically ✅, only Phase D remains
> Note: A–H are **implementation phases** (in tasks/tests); the design doc itself uses decision points P.1–P.13.

| Phase | What it is | Status |
|---|---|---|
| **A** (C0+C1–C4) | Write all-red tests first → PluginManifest / mcpclient stdio+transport / generalize pluginCapability / boot discovery wired into the composition root | ✅ `#146/#136-139` |
| **B** | Connector layer (Nango-proxy) | ✅ `#140` (audited clean this session, 146/146) |
| **C** | skill = Agent Skills (SKILL.md + progressive loading) | ✅ `#141` (~90%, the lightest) |
| **D · Dissolve** | ACL done (discovery filtering at session setup); observer = device/system observability surface (a small Zabbix); secret-scan merged into connectors (B) | ✅ `#101` observability surface is real (gopsutil host disk/mem/load + cgroup CPU/mem + real db/redis/storage/search ping, `cmd/server/port/sysinfo.go`); ACL/secret-scan are in place |
| **E** | as-MCP-server facade (aggregates plugin owner tools into one endpoint) | ✅ `#143` |
| **F** | MCP Apps UI (`ui://` cards rendered in chat) | ✅ `#134` |
| **(G)** | (no G in the tasks; skipped/unnumbered) | — |
| **H** | Management surface (origin + enable/disable + admin capability panel) | ✅ `#145` |

→ **Layer ① is complete** (Phase D's `#101` observability surface is real; see the table above).

### Layer ② · "Replacement" migration — **decision point P.2 states explicitly "migration comes later; coexist first"** 🟡 (eiab did most of it in 2026-09)
Once the mechanism (layer ①) was built, **everything-is-a-block (2026-09-13→18) externalized the visitor/leaf capabilities + all connectors into sandboxed JS blocks**: `ask_visitor`/`summarize_conversation`/`calendar.book`/`corpus.retrieval`/`mail.send` + `caldav`/`smtp`/`google-calendar`/`telegram` are now all `backend/blocks/*/manifest.yaml` + a JS server, with no per-capability Go; `me`/`seo`/`codes` are no longer registry fibers either, but domain `fp.Op`s projected through convergence/dispatcher. `backend/internal/connector/` is cleared out (0 Go files).
**Still in core (not externalized)**: `jobs`/`resume`/`applications` (`OwnerFibers` in `owner/jobs`, still `MustRegister`) + a few loader fibers. So `MustRegister` (`plugin/registry/registry.go`) + the in-process registry **still exist**, and the builtin count has not reached zero (the `ListByOrigin` symbol is deleted; origin filtering goes through `shipped.go` `Shipped()`/`OriginOf`). The feature floor (P.1c: cross-cutting gating/state all stay in core) must not shrink; every item has a spec guarding it. **The remaining externalization is cleanup and no longer ripples through everything.**
- → **Design + red-first test plan are out**: [`docs/design/layer2-externalize-jobs.md`](layer2-externalize-jobs.md). Decision = **split**: `jobs`/`resume` → blocks (backed by `blockstore`); `applications.commit` → dispatcher `fp.Op` (stays in the host and leaves `MustRegister` like me/seo/codes, because issuing AccessCode+role makes it a deterministic state holder and it does not go into the sandbox). Goal = **zero Go capability fibers in core** (`RegisterOwnerFibers` emptied, only the 3 loaders remain).

### Layer ③ · agent-as-injectable-driver — Bridge abstraction ✅, runtime shape 🚧
- ✅ **The Driver/Bridge interface is extracted** (`#153` agentcore extracts Driver, `#154` eval made into a faithful mini-host) — the structural implementation of decision point P.13 has landed.
- 🚧 **Still missing**: promote "inject-and-launch" from test-only to a **first-class runtime shape** → run many prompts in parallel and find good prompts experimentally ("eval is the type system"; prompts are verified, not designed). This is also the missing **"quality half"** (selection/shaping) of eight-controls.

---

## ~~Block 3 · prod single-machine deployable~~ — **cut** (owner decision 2026-07)

- The server + domain + certificate setup is something **the owner binds on their own at the domain/server provider** (we do not ship Caddy/LE automatic certificates — the "one command + automatic LE" vision in CLAUDE.md is **void**).
- We only need to **know our own domain**, and the mechanism to fill it in **already exists** (owner profile `public_url` + `allowed-domains`, `routes/admin/public_url.go`+`domains.go`). → Effectively done; no longer a major block.
- **2026-09-28 owner reversal (partial restore)**: "learn from how mature self-hosted products do it" (PostHog hobby / Plausible CE). A new user installs with one command: `infra/scripts/install.sh --domain D` downloads compose, generates all secrets into `.env` (written once only), layers `infra/deploy/compose.caddy.yml` (Caddy `reverse-proxy`, automatic LE for a single domain), and prints the claim link; without `--domain` it layers `compose.port.yml` and you bring your own proxy. **Only a single fixed domain**, not the on-demand multi-domain issuance that was cut originally. Verification: `make install-e2e` (docker-in-docker clean host → HTTPS claim/login/home page → rerun keeps `.env`).

---

## Not major blocks (odd-job cleanup, done in one pass)

Truly independent, unrelated to the two major blocks, can be interleaved: `#103` (role card prompt editing), `#104` (per-code prompt), `#106` (inference billing), `#117` (URL env prod fallback), `#152` (rename mocks properly), `#100`+`#115` (recovery phrase + tests), `#111` (TOTP, later), `#126` (interview→application, job-loop), `#116` (walk through today's changes), `#133` (Gmail real-domain self-test — connector done + manual verification on the deploy side).

**Lightly coupled (can be done independently, but the major blocks will touch them; mind the order)**: `#105` (MCP key download + README — touches the Block 2 MCP endpoint; suggest finalizing after Block 2), `#132` (generic retry HTTP infra + ban raw http — paves the way for Block 2 plugins; no conflict doing it first), `#109`/`#110` (chat summarize/booking buttons — only call endpoints; externalization sits behind the endpoints, so independent), `#129` (summary revise — logic inside a capability, independent).

> Reassignment note: `#101` (observer = small Zabbix) → Block 2 Phase D; `#102` (/admin/seo real backend) → **Block 1** (seo is a misnomer = public corpus landing/reader, see 1a/1c); `#118` (MCP vs HTTP admin parity) → **Block 2 layer ②** (as-MCP-server, verified during externalization). These three were originally part of the major blocks and had been mislisted as odd jobs.

## Deferred

- **multi-vault ingestion** 🚧: demote the vault from sync-unit to named source (git-monorepo as transport, namespaced subtrees, per-source snapshot diff). Explicitly **single vault first**; later.

---

## My recommended order (with reasons)

1. **Block 1 first, starting with 1b graph-crawling retrieval** — the edge table is built and non-vector is decided, so retrieval quality jumps directly (dialogic retrieval over the owner's graph = the differentiation itself), and it **does not depend on finishing the sync side first**.
2. Then **1a** (folder-note + wiki/output sync, feeding more into the graph).
3. Then **1c** (callout / tikz / widget iframe / owner-CSS sync).
4. **Block 2** (platform replacement + driver) — structural; think it through before moving; can be staggered with Block 1.

**Before starting each 🚧/⬜, produce a design + tests first** (landing designs for each slice of Block 1: 1b's BFS depth/ranking/ACL in the query; 1a's parent_id derived from folders; 1c widget's postMessage schema + CSS sanitize rules).
