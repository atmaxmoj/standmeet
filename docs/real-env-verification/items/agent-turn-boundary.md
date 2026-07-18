# agent-turn-boundary — Agent loop: the iteration/time boundary synthesizes

- **Status:** ⬜ not started (new round)
- **Module:** when a turn exhausts its iteration or time budget on a long tool chain, the boundary **synthesizes one grounded answer from gathered evidence** — it never emits planning narration as the product, never denies an existing note. The boundary is engineered, not just a bigger number. Home of the real-model eval rig.
- **Surface:** visitor chat (backend agent loop) + the eval harness (`eval-harness/experiment_test.go`).
- **Real dep:** real DeepSeek. The mock repro is circular (the mock IS my hypothesis of the bug) — this module verifies against the real model only.
- **Inherits (historical finding IDs):** `F-A-4` (deterministic loop budget → planning narration instead of a synthesized answer).
- **Backing e2e / evals:** `agent_product_test.go` (deterministic P1 guards) · `eval-harness/{narration_live,chain_exhaustion_live,experiment}_test.go` (real-model). Context evals lane: `eval-harness/{compaction,doc-context,cross-conversation}-test.sh`.

## Checks

### 1 — Broad question gets grounded synthesis, not narration ⭐  (was F-A-4)
- **Steps:** a broad "survey everything" question that forces many wide searches → let the loop approach its iteration/time budget → inspect the product.
- **Expected:** the turn returns a synthesized, corpus-grounded answer; the product contains no planning narration ("Let me survey… Let me check my notes…"); the boundary fires a forced-final synthesis on a detached context, not a hard stop.
- **Backing:** `narration_live_test.go` · `experiment_test.go` (broad shape). Deterministic: `agent_product_test.go`.
- **Result:** ⬜
### 2 — Deep chain exhaustion behaves gracefully  (was F-A-4)
- **Steps:** a sequential 33-hop concept chain (read → next → read) that forces a deep crawl → let it hit the boundary.
- **Expected:** a PARTIAL digest framed as "ran out of budget" (head+tail evidence retained), **never** a claim that an existing note doesn't exist.
- **Backing:** `chain_exhaustion_live_test.go` · `experiment_test.go` (chain shape).
- **Result:** ⬜
### 3 — Context evals promoted to a real-LLM lane  (was §A19)
- **Steps:** run `eval-harness/{compaction-test.sh,doc-context-test.sh,cross-conversation-test.sh}` against DeepSeek (`EVAL_KEY`).
- **Expected:** each passes on a real model — compaction retains the thread, doc-context grounds, cross-conversation carries state. `manual-only` today (real-key, single-persona); the ask is to schedule them as a routine real-LLM lane.
- **Backing test:** the scripts above (real-key manual, not CI). No CI backing (gap).
- **Result:** ⬜
## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)
On a budget-exhausting turn the visitor sees ONE coherent answer, not a wall of "let me…" lines; no error card, no truncated-mid-tool bubble.

## Findings
(record here; also log `../findings.md`, ID `F-A-4` historical anchor)

- **F-A-4 fixed** (4 commits): head+tail evidence ledger with PARTIAL digest; process≠product classifier (text in a round ending with tool calls is process); force-final synthesis on `WithoutCancel`+60s; both walls engineered (iterations 8→24, time 120→300s). Regressed manually on the real prod GUI: clean answer + live `corpus_map`/`corpus_resolve`.
