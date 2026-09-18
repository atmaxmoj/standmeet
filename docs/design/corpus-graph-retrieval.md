# Corpus graph retrieval — agent-driven, by design (decision record)

> **Status: DECIDED 2026-09-18 — do NOT build a server-side graph walk / ranker.**
> Graph retrieval already ships as an **agent-driven** capability: the visitor
> agent traverses the owner's `[[link]]` graph itself, one hop per tool call.
> A single-call server-side bounded-BFS with fused ranking was considered and
> **declined** — the "which nodes are relevant / how deep to go" judgment is
> *reasoning* (the agent's job), not deterministic state (the host's job).
> This closes roadmap 1b's "爬网 (graph retrieval)" line.

## What ships today (the retrieval surface)

corpus is a **linked tree**: every node is a note (has a body) and a parent of
finer nodes, addressed by path; nodes reference each other with `[[wikilinks]]`.
The `corpus.retrieval` block (sandboxed JS) exposes 8 read-only tools, each
reaching host data over the unix socket (`backend/blocks/corpus.retrieval/manifest.yaml`):

| tool | what it does | graph? |
|---|---|---|
| `corpus_search` | keyword search — Meili (wiki/output/subjectivity) + Postgres FT (writings), ranked, typo-tolerant, can miss uncut tokens | — |
| `corpus_grep` | exhaustive exact-string / regex, with matching lines | — |
| `corpus_map` | birds-eye skeleton: the `parent_id` tree + a count per branch (its `frontier` is **tree**-density expansion, not a graph walk) | tree |
| `corpus_list` | a node's direct children | tree |
| `corpus_resolve` | `[[name]]` / title → exact path | — |
| `corpus_peek` | cheap multi-node preview (title, tags, headings, outlinks, first line) | — |
| `corpus_read` | one node's full body | — |
| **`corpus_links`** | a node's **outgoing links + backlinks (1 hop)**, each neighbor ACL-checked | **graph, 1-hop** |

Underneath:
- **Edges** live in `note_refs` (`db/schema.sql:305`; `(src_id, dst_id, owner_id)`,
  **no `kind` column** — one edge type, resolved `[[Title]]` links), rebuilt on
  every note save/promote (`wiki_crosslink.go:113`).
- **ACL** — `AllowsCorpusEntry` (`access/entity/path_acl.go:143`) gates **every**
  row and **every** neighbor (`corpus_lister_pg_links.go:74` `neighborMeta` drops a
  neighbor the visitor can't read *before* exposing it).
- **Traversal is the agent's** — the block's own instructions prescribe it
  (`infra/plugins/retrieval/retrieval-mcp.js:27-31`): map → read → follow `[[links]]`
  via `corpus_links` / `corpus_resolve`, going deeper by calling again. Multi-hop
  is delegated reasoning, one hop per call.

So "walk the owner's graph to related notes" is **already reachable** — it is the
agent re-calling `corpus_links`. There is no missing capability.

## Options considered

| option | server does | agent does | verdict |
|---|---|---|---|
| **① agent-driven 1-hop (status quo)** | nothing new | traverses by re-calling `corpus_links` | **CHOSEN** — it is the design; sufficient |
| ② deterministic `corpus_walk(seed, depth, budget)` | expand N hops + per-hop ACL + group by distance, **no ranking** | judges relevance over the returned neighborhood | not now — a round-trip optimization, not a capability; revisit only if latency bites |
| ③ `corpus_walk` + fused rank (lexical × distance × degree) | walk **and** rank relevance | receives a pre-ranked list | **rejected** — the server would *guess* relevance, exactly what 1b's "no vector, relevance = the owner's `[[links]]`" decision refuses; ranking is reasoning, not host state |

## Decision & rationale

**Chosen: ① — do not build a server-side walk.** Two reasons:

1. **The capability already exists**, by deliberate design: the agent drives depth
   via 1-hop `corpus_links`, as the block instructs. Nothing is blocked.
2. **A server-side ranker crosses the principle line.** StandMeet is the
   *deterministic state holder*; the agent is the *reasoning*. Deciding which
   linked notes matter and how far to walk is reasoning. Baking a relevance
   heuristic into the host (option ③) is the same "machine guesses relevance" that
   1b explicitly rejected when it chose owner-authored `[[links]]` over vectors.

## If this is ever reopened

The only legitimate motive is **round-trip latency** in visitor chat (each hop is
an MCP call). If that ever bites, build **option ② only**: a deterministic
`corpus_walk` that expands the neighborhood + applies the existing per-hop ACL gate
+ returns nodes grouped by hop distance — and returns **no relevance ranking**
(the agent still judges). Seams, if needed: a `Lister.Neighborhood(...)` method
(`corpus_lister.go`) composing `Search`/`AdminOutboundFor`/`AdminBacklinksFor` +
`neighborMeta`, plus one `corpus_walk` host_op and one manifest/`retrieval-mcp.js`
line. Ranking stays out.
