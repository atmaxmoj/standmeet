# agent-turn-boundary — Agent loop: the iteration/time boundary synthesizes

- **Module:** When a turn exhausts its iteration or time budget on a long tool chain, the boundary synthesizes one grounded answer from the evidence gathered so far. It never ships planning narration as the product, and it never denies a note that exists. The boundary is engineered; a bigger budget is not a boundary.
- **Surface:** Visitor chat, driven by the backend agent loop. Also the eval harness.
- **Real dep:** A real model. A mock reproduction is circular here, because the mock would encode the very hypothesis under test.
- **Backing e2e:** `agent_product_test.go` for the deterministic guards, and the real-model lane `eval-harness/{narration_live,chain_exhaustion_live,experiment}_test.go`. Context evals: `eval-harness/{compaction,doc-context,cross-conversation}-test.sh`.

## Checks

### 1 — A budget-exhausting broad question returns synthesis, not narration ⭐
- **Steps:** Ask a question broad enough to force many wide searches. Let the loop approach its budget. Read what the visitor receives.
- **Expected:** One synthesized, corpus-grounded answer. The product contains no planning narration. The boundary fires a forced final synthesis on a detached context rather than stopping hard.
- **Backing test:** `narration_live_test.go` · `agent_product_test.go`

### 2 — A deep chain that runs out says so, and keeps its evidence
- **Steps:** Ask something that forces a long sequential crawl — read, follow, read again, dozens of hops. Let it hit the boundary. Read the answer.
- **Expected:** A partial digest framed as having run out of budget, retaining evidence from both the start and the end of the chain. It never claims that a note it did not reach does not exist.
- **Backing test:** `chain_exhaustion_live_test.go` · `experiment_test.go`

### 3 — Context behaviour holds on a real model
- **Steps:** Run the compaction, doc-context and cross-conversation evals against a real model.
- **Expected:** Compaction retains the thread. Doc-context grounds. Cross-conversation carries state.
- **Mock gap:** These run by hand with a real key and a single persona. Nothing schedules them, so a regression waits for someone to remember.
- **Backing test:** `eval-harness/*-test.sh` · CI → `gap`

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)

On a budget-exhausting turn the visitor sees one coherent answer, not a wall of "let me…" lines.
No error card and no bubble truncated in the middle of a tool call.
A partial answer says it is partial — silence about the limit is what makes a truncated answer read as a wrong one.
