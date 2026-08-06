# Open work — how the tests get written

**Status:** design (2026-08-06). Companion to `open-work-multi-provider-gas-grep-i18n.md`, in the
`*-tests.md` convention this repo already uses (`job-loop-tests.md`, `connector-deps-tests.md`).
That document lists *what* is asserted; this one is about *how each assertion is made able to fail*,
which surface it drives, and what the harness has to grow first.

## 0. The rules these obey

Five failure modes cost real time in this codebase; every test below is designed against them.

1. **An assertion that cannot fail teaches nothing.** `toHaveText(/connected/i)` also matches "not
   connected"; `getByText(…).toBeVisible()` also passes when both languages are in the DOM and CSS
   hides one. Anchor, or count, or assert absence with `toHaveCount(0)`.
2. **A receipt must be specific to this action.** A generic toast is satisfied by the previous
   action's leftover. Wait for the thing that only this action produces.
3. **Green through the API says nothing about the face.** A capability reachable over MCP can be
   fully green while no UI exists. If the feature has an owner-facing control, one test drives the
   control.
4. **Structure over stopwatch.** Count dials, count queries, count rows — not milliseconds. Elapsed
   time drifts with the machine; "how many times did it do that" does not.
5. **One implementation, four consumers → test the seam once, then test that each consumer is wired
   to it.** Not the full rule matrix four times.

Two more that are specific to this batch:

6. **Prove RED against the images that are actually running** (`make test-red SPEC=…`), before
   `make test-only` rebuilds the fix in. A test written after the fix can only ever be seen green.
7. **A test that fails because the world improved is information, not breakage** — say so in the
   test, next to the assertion (this matters for the Meili-vs-grep contrast below).

---

## 1. Harness gaps — build these before the feature tests

These do not exist today. Each one blocks a test that otherwise has to be written as a weaker
assertion, and a weaker assertion is how a feature ships broken.

### 1.1 The mock gateway cannot say **who** called it — blocks #6

`mock-stack/llm-gateway` inspects no `Authorization`, records no path, and exposes only
`{tools, replies}` from `/__mock/inference/state`. `byoai-chat.spec.ts` gets away with pointing the
visitor's endpoint at the sidecar and observing that a reply came back — that works when there is one
alternative, and stops working the moment "which of my three providers served this turn" is the
question.

**Build:** a tagged last-request recorder, in the same keyed style as the existing script queue so
parallel workers cannot pollute each other:

```
GET /__mock/inference/last_request?tag=<marker>
    → { path, model, auth_prefix, cached: bool }
```

The `<marker>` is the unique token `mock-llm-script.ts` already embeds in the user message. Keyed,
not global — a global "last request" is the shared-state trap that `no-rerun-on-flake` was written
about.

### 1.2 Reported usage is hardcoded `input_tokens: 1, output_tokens: 1` — shapes #7

`messages.go:137`. Two consequences:

- basic gas arithmetic is testable **without touching the mock** — make the tank small (`gas_tokens = 3`:
  first turn costs 2 and passes, second turn hits 4 > 3 and is refused). Prefer this; do not change
  shared infrastructure for something a fixture value can express.
- the `cached_tokens` column has no way to be non-zero in e2e, so its plumbing would ship untested.
  That needs `POST /__mock/inference/next_usage {key, input, output, cache_read}` — same registration-KV
  shape as `next_tool` / `next_reply`. Second stage, only when that column is wired.

### 1.3 The usage prune runs **once at boot** — blocks #7's retention test

`cmd/server/boot_wireup.go:78 runBootMaintenance` calls `InferenceUsageRepo.Cleanup` one time at
startup, best-effort. A spec cannot trigger it without restarting the backend.

This is also a **product bug hiding in a test problem**: an instance that stays up for sixty days
never prunes again. Fix both at once by moving it to `internal/infra/periodic` (daily) — the repo
already requires every timer to go through that scheduler, and a periodic job is triggerable from a
spec. Do this before writing the retention test, not after.

### 1.4 No multilingual vault fixture — blocks #10

The e2e vault fixture has no `[!i18n]` note. Needed, shaped like the live sample:

- one note with **several `[!i18n]` regions and neutral prose between them** — without the neutral
  prose, the single most valuable test (#10-3) cannot fail;
- one **three-language** note — the real vault has 596 bilingual notes and zero trilingual ones, so
  "N is unbounded" is otherwise asserted by nothing;
- one deliberately malformed note per intake test (panes disagreeing with `langs`, an orphan
  `[!lang]`, a duplicate code).

### 1.5 No known Meili blind spot — shapes #8

The contrast test needs a string Meili's tokenizer does not match but a literal search does. Candidates:
a mid-word substring (`ubsyste` inside `subsystem`), a punctuation-adjacent token, a CJK bigram
straddling a segmentation boundary. **Verify the chosen string against the running Meili first** —
if `corpus_search` already finds it, the contrast is fake and the test is decoration.

---

## 2. #6 multi-provider

| # | What it pins | Surface | Goes red when | Trap it guards |
|---|---|---|---|---|
| 1 | code override beats role override | e2e: visitor turn on a code whose role has a different provider; read `last_request.model` (§1.1) | the chain is reordered, or either override is ignored | asserting on an internal getter instead of the outbound request — that passes while the request still goes to the old provider |
| 2 | role override applies when the code has none | same | role tier dropped | — |
| 3 | neither → the default row | same | resolution falls through to nothing / errors | — |
| 4 | byoai still wins over a code override | e2e: byoai session on an overridden code | the new tiers are inserted above byoai instead of below | the visitor paying for the owner's provider — a money bug, not a preference bug |
| 5 | deleting a referenced provider → next turn silently uses the default | e2e: delete via the owner panel, then a visitor turn | `ON DELETE SET NULL` missing, or a "provider not found" error reaches the visitor | asserting only "no crash"; the point is *silence* — the visitor must see nothing at all |
| 6 | deleting the default is refused, with a reason | e2e (owner panel) | the guard is absent | a generic 500 instead of a sentence |
| 7 | `set_default` moves the flag rather than adding one | e2e + the partial unique index | someone writes `UPDATE … SET is_default = true` without clearing | the index makes this structurally impossible; the test proves the index is *there* |
| 8 | first-run claim creates exactly one row, marked default | e2e: fresh instance → claim → provider list has 1 | `claim.go` still writes the old columns | this is the path nobody re-runs after the first day |
| 9 | the code form and the role form each have a working picker | e2e **driving the UI**, not the API | the backend lands and the UI is forgotten | rule 3 — the whole feature can be green over MCP with no owner-facing control at all |

Test 1 is the keystone. Give the two providers distinct `model` strings and assert on the recorded
model: the model is what the outbound request actually carried, so nothing about the assertion can be
satisfied by internal state.

---

## 3. #7 gas paddle

| # | What it pins | Surface | Goes red when | Trap it guards |
|---|---|---|---|---|
| 1 | an unmetered role issues **no gas query at all** | Go, `conversation/usecase` with a counting double (the `dialCountingCap` pattern from `registry_tool_dispatch_test.go`) | the default path grows a query, even one that returns "unlimited" | "configured as infinite" quietly replacing "structurally absent" — the default path is what 99% of owners run |
| 2 | an exhausted tank refuses the send **before the message row is written** | e2e: tank = 3, two turns; assert the second is refused **and** `messages` did not grow | the check moves after the write, or only the UI is gated | asserting only the UI: the row is still there, the tokens were still spent |
| 3 | the visitor sees a sentence, not jargon | same turn | someone surfaces `ErrGasExhausted` raw | `quota exceeded` reaching a stranger's screen |
| 4 | two roles on one provider share one tank | e2e: spend through role A, assert role B's remaining dropped | per-role accounting sneaks in | this is the difference between "a tank" and "a per-role allowance" — the owner's mental model of "I put 50 into this provider" |
| 5 | byoai turns never touch the tank | e2e | `usageBillable` regressed | the visitor's own key draining the owner's fuel |
| 6 | a gas-relevant row older than 7 days survives the prune; an irrelevant one does not | e2e, after §1.3 makes the prune triggerable; age the rows with `docker exec psql` (the `expireUploadedAccessToken` pattern) | the prune condition is written without the exemption | fuel that grows back by itself — the failure is invisible until an owner notices free tokens |
| 7 | refilling the tank makes sending work again | e2e | the refusal is cached somewhere | — |

Test 1 is the one that will be tempting to skip and is the most important: it is the only one that
distinguishes "unmetered behaves like today" from "unmetered is a configuration of the new code".

---

## 4. #8 instant grep

| # | What it pins | Surface | Goes red when | Trap it guards |
|---|---|---|---|---|
| 1 | grep finds a string Meili misses | e2e over both tools, one fixture note | the literal path is not literal (tokenizing, stemming, normalizing) | if this goes red because **Meili improved**, that is information: pick a new string and write down why. Say so in the test. |
| 2 | never-miss, as a property | Go: N generated notes, a random substring of one, assert found — over the whole fixture corpus, not one note | the index filter drops a candidate it should have kept | a single hand-picked example proves nothing about a *property*; the whole selling point is arithmetic, so test it arithmetically |
| 3 | ACL: out-of-scope notes never appear | e2e, **reusing the `corpus_search` ACL fixture** | the new host op forgets the scope filter | a second, weaker door into the corpus — a new tool is a new door |
| 4 | regex metacharacters honoured; an invalid pattern is a human error | e2e | the pattern is passed through raw, or a bad pattern 500s | the visitor-facing error rule |
| 5 | both tools are offered, and their descriptions state **different** guarantees | Go golden snapshot of the two description strings | someone edits one to sound like the other | this is the feature: the agent chooses by description. If they converge, the agent picks arbitrarily and never-miss stops being reachable |
| 6 | stage 2 does not change answers | Go: the same query set through the scan implementation and the index implementation returns identical sets | the index becomes a filter that also drops | when the index arrives it must be *only* faster — this test is written now and kept |

Test 6 exists from the start even though stage 2 is later: it is the definition of what stage 2 is
allowed to be.

---

## 5. #10 multilingual

**Split by layer, deliberately.** The tolerance table is a matrix — running it through e2e would be
eighteen browser round-trips for rules that are a pure function of text:

- **Go table test over `i18n.Validate`** — one case per tolerance row, plus the parser traps
  (a `[!i18n]` inside a fenced code block is not a block; a `[!lang]` at depth ≥3 is not a pane).
  This is where the rules live and where they are exhaustively covered.
- **e2e** — that each of the four consumers is *wired to that function* and surfaces its result:
  write op rejects, check tool returns the same diagnostics without writing, sync accepts and shows
  them, renderer degrades. Four tests, not four matrices.

| # | What it pins | Surface | Goes red when | Trap it guards |
|---|---|---|---|---|
| 1 | default renders `lang`; the other language's prose has `toHaveCount(0)` | e2e reader | the implementation ships both languages and hides one with CSS | **the** characteristic false green here — and the implementation most likely to be written, because it is what copying Obsidian produces |
| 2 | switcher lists `langs` in order; clicking adds `?lang=zh` and swaps the prose | e2e | order taken from a map | — |
| 3 | prose **outside** `[!i18n]` appears under both languages | e2e, needs the multi-region fixture (§1.4) | the note is modelled as N documents | the highest-value test in the set: the N-documents model passes 1, 2, 4, 5 and fails only this one |
| 4 | not one character of the button-row HTML appears | e2e: neither as a control nor as text | raw HTML leaks through the pipeline | — |
| 5 | the title changes with the language | e2e | title read from frontmatter instead of the pane | decision 1 lives or dies here |
| 6 | a note without `langs` renders exactly as today | e2e | the new path captures monolingual notes | regression insurance for the minority — 596 of the vault's notes are bilingual, so the *monolingual* case is the one nobody will exercise by accident |
| 7 | `langs` lists 3, 2 panes exist → whole note in `lang`, no 500 | e2e | partial rendering, or a crash | half-rendered is worse than degraded: it looks correct |
| 8 | `?lang=de` → falls back to `lang` | e2e | falls back to `langs[0]` | the decision that was re-asked twice; pin it so it stops moving |
| 9 | `GET ?lang=zh` server-renders Chinese | e2e without JS | client-only switching | crawlers and agents fetch this URL; client-side switching serves them the wrong language silently |
| 10 | one `hreflang` per language, same slug | e2e | — | — |
| 11 | searching a Chinese title returns **one** hit, and its URI is that slug | e2e | the indexer splits the note into N docs | the duplicate-prose consequence, observed from the search side |
| 12 | the agent's context carries **one** language's prose | e2e: assert it is not fed twice; do **not** assert which one | both panes are concatenated into the context | asserting the model's choice — that drifts, and a drifting assertion gets deleted |
| 13 | the agent can see which languages exist | e2e | the language set is not exposed | without it, "the agent decides" is not implementable |
| 14 | write op rejects a malformed note, names the fault, carries a copyable example, **and the note is not created** | e2e over MCP | the note is created anyway | "rejected" that still writes is the worst outcome — assert the absence via `corpus.list` |
| 15 | the minimum form (nested callouts, zero frontmatter) is accepted | e2e over MCP | validation demands frontmatter | the whole point of lowering the barrier |
| 16 | `corpus.check_i18n` returns the same diagnostics and writes nothing | e2e: compare payloads with 14, then assert `corpus.list` is unchanged | the check grows its own copy of the rules | the four-consumer drift this design exists to prevent |
| 17 | sync accepts a malformed note **and** the diagnostic is visible in the admin sync panel | e2e | sync rejects (owner loses content), or accepts silently | silence here is the same disease as a sandbox that fails to start and logs nothing |

---

## 6. Where each thing lives, and why

| Layer | Used for | Why not elsewhere |
|---|---|---|
| **Go, pure function** | `i18n.Validate` tolerance matrix; grep's never-miss property; the two tool descriptions | matrices and properties need dozens of cases; a browser round-trip per case buys nothing and costs minutes |
| **Go, counting double** | "an unmetered role issues no gas query"; "one card's app-state dials one sandbox" | the assertion is *how many times*, which no product surface reports |
| **e2e over MCP** | write op / check tool parity; provider chain resolution | this is the product's real management surface, not a backdoor |
| **e2e driving the UI** | the provider pickers on the code and role forms; the admin diagnostics panel | a feature can be entirely green over MCP with no control on screen — that has happened here before |
| **Guard script** | none of these need one yet | guards are for invariants a reviewer cannot hold in their head; these four are features, not invariants |

## 7. Order of construction

For each feature: harness gap → the one test that can already fail today → the feature → the rest of
the tests. The gaps in §1 come first because each of them is the difference between an assertion and
a decoration.
