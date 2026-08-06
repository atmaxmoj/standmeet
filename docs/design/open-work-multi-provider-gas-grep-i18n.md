# Open work — multi-provider · gas paddle · instant grep · multilingual

**Status:** design (2026-08-06). Covers the four remaining feature todos (#6 #7 #8 #10). The §A–§R
real-env audit (#5) is deliberately last and is not in here. #9 (graph retrieval) was closed: graph
retrieval is *one retrieval option among several* and that option has existed since 2026-07
(`corpus_links` / `corpus_map` / `corpus_resolve`).

Every "today" claim below was read out of the tree on 2026-08-06 and carries its file. The point of
writing them down is that each feature turned out to have a **precedent in this codebase** — the
design work is mostly "do what that one did", and the expensive mistakes came from not looking.

---

## 0. The precedent table

| Feature | Nearest thing that already exists | What it settles |
|---|---|---|
| #6 multi-provider | `presets.go` (provider metadata is data, one table) + `capconfig` scopes (owner/code/role) | where provider metadata lives; how per-scope overrides are stored |
| #7 gas paddle | `visitor_turn_quota.go` (turn quota) | preflight position, derived counting, "not configured" path, sentinel error |
| #8 instant grep | `mcp-servers/retrieval` (7 tools, one plugin) + `search/search.go` (Meili as a derived projection) | new search = a new tool + a new projection, never a change to the source of truth |
| #10 multilingual | `markdown-callouts.ts` (the existing callout transform) + `obsidian/sync_note.go` (the existing frontmatter parser) | render path and parse path both already exist; this extends them |

---

## #6 — Multi-provider: a list, a default, per-code / per-role overrides

### Today

One provider per owner, four columns on `owners` (`db/schema.sql:48-51`):

```sql
ai_provider          text  NOT NULL DEFAULT 'anthropic',
ai_provider_key_enc  bytea NOT NULL DEFAULT ''::bytea,
ai_endpoint          text  NOT NULL DEFAULT '',
ai_model             text  NOT NULL DEFAULT '',
```

`inference/resolver.go` has exactly two tiers:

1. `mode='byoai'` + visitor cred present → the visitor's own key (`VisitorCred`, untrusted by type)
2. otherwise → the owner row, key opened at the composition root

Neither `access_codes` nor `roles` carries any provider field.

**18 files read those columns** — this is the real size of the change, not the table:

```
cmd/server/{boot_http,boot_wireup,main,unseal}.go   cmd/server/port/ai_provider.go
cmd/server/wire/dispatcher.go
internal/conversation/inference/{errors,owner_lookup,presets,resolver}.go
internal/conversation/usecase/visitor_public.go
internal/owner/{facade/facade_usecase,ops/settings,repo/owners,usecase/ai_provider}.go
internal/routes/admin/{ai_provider,claim}.go        internal/routes/public/sessions.go
```

Two of those are worth calling out: `routes/admin/claim.go` writes a provider during **first-run
claim**, and `routes/public/sessions.go` reads provider state into the **visitor session response**.
Any migration that forgets either leaves a broken first-run or a session that can't say which model
it is on.

`presets.go` is already the right shape — `presetTable` is "the only place a new provider is added",
`ProviderPreset{Name, Label, BaseURL, KeyPrefix}`, and it **deliberately has no default model**
("防止因为默认指过时/错误模型而不自知"). Multi-provider needs no new metadata concept, only rows.

### Target

```
byoai (visitor's own key)  >  code.provider  >  role.provider  >  owner default
```

Decided 2026-08-06: **code beats role** — the code is the ticket that was handed out, it is the more
specific statement. Decided 2026-08-05: **a deleted provider falls back to the default**, no
FK-RESTRICT, no unbinding ritual; dangling references resolve to the default at read time. **Deleting
the default itself is refused** — there is nothing to fall back to.

### Schema

```sql
CREATE TABLE owner_providers (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id    uuid NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    label       text NOT NULL,                       -- owner's name for this entry ("work key")
    provider    text NOT NULL,                       -- canonical preset name; 'custom' allowed
    key_enc     bytea NOT NULL DEFAULT ''::bytea,    -- sealed; opened only in cmd/server/unseal.go
    endpoint    text NOT NULL DEFAULT '',
    model       text NOT NULL DEFAULT '',
    is_default  boolean NOT NULL DEFAULT false,
    created_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (owner_id, label)
);
-- exactly one default per owner
CREATE UNIQUE INDEX owner_providers_one_default
    ON owner_providers (owner_id) WHERE is_default;

ALTER TABLE access_codes ADD COLUMN provider_id uuid REFERENCES owner_providers(id) ON DELETE SET NULL;
ALTER TABLE roles        ADD COLUMN provider_id uuid REFERENCES owner_providers(id) ON DELETE SET NULL;
```

`ON DELETE SET NULL` **is** the fallback rule expressed in the schema: the reference goes away, the
row stays, resolution lands on the default. The partial unique index makes "two defaults" impossible
rather than checked.

The four `owners.ai_*` columns migrate into one `owner_providers` row (`is_default = true`) and are
then dropped. Nothing is deployed, so this is a rewrite of `schema.sql`, not an ALTER script — but
note `schema.sql` only applies to a **fresh volume**; `make test-fresh` is the only run that proves it.

### Code

- **`inference/resolver.go`** — `ResolveInput` grows `CodeID` / `RoleID`; a new `ProviderLookup`
  resolves the chain and returns the same `*Cred`. The two existing tiers stay; three more slot in
  front of "owner default". Everything downstream of `Cred` is untouched — that is the whole point of
  the type.
- **`cmd/server/unseal.go`** — still the only place that opens a key. It grows from "open the owner's
  key" to "open the key of the resolved provider row". #4 already put the seam here; N sealed rows
  need no new seam.
- **`internal/owner/ops/providers.go`** (new) — `providers.list / create / update / delete /
  set_default`, MCP-first like every other owner surface. `delete` refuses the default (sentinel →
  `fp.Conflict`).
- **`routes/admin/claim.go`** — first-run writes the first `owner_providers` row instead of the
  owner columns.
- **`routes/public/sessions.go`** — the session response already reports provider state; it now
  reports the *resolved* one, so a visitor on a code with an override sees the truth.
- **Admin UI** — a provider list (add / edit / delete / mark default) in the AI-provider panel;
  a provider picker on the code form and the role form, defaulting to "(instance default)".

### Tests

RED before the fix, by construction:

1. code with provider A + its role with provider B → the turn goes to **A** (assert the outbound
   request's model/endpoint via `external-mock`, not an internal getter).
2. code with no override, role with B → **B**.
3. neither → the default row.
4. `byoai` session on a code with an override → still the visitor's key (byoai stays on top).
5. delete the provider a code points at → that code's next turn uses the default, **no error shown
   to the visitor** (the fallback is silent by design).
6. delete the default → refused, with a message that says why.
7. two rows marked default → impossible (the index); assert the second `set_default` clears the first.
8. first-run claim creates exactly one row, marked default.

---

## #7 — Gas paddle: per-provider fuel, per-role gauge, optional

### Precedent (this is the whole design)

`internal/conversation/usecase/visitor_turn_quota.go`:

```go
if code.MaxTurnsPerSession == nil || *code.MaxTurnsPerSession <= 0 {
    return nil                              // not configured → return early. This *is* today's path.
}
count, _ := countTurnsForQuota(...)         // COUNT(*), there is no counter column
if count >= *code.MaxTurnsPerSession {
    return access.ErrTurnQuotaReached       // one sentinel, checked once before the write
}
```

`db/queries/conversation/conversations.sql:58` says it outright: *"turn 数不再存,读时从 messages
派生"*. Turn accounting has no counter, no "where does it stop" question, and no debate about what
counts as a turn. Gas is the same mechanism with a different dimension.

### Target

- fuel lives on the **provider** (`owner_providers.gas_tokens`, NULL = unmetered);
- the **role** carries a paddle flag (`roles.gas_metered`, default false) that decides whether the
  check runs at all;
- two roles pointing at one provider share one tank — that is what "I put 50 into this provider"
  means;
- exhausted → the visitor's next message is refused before it is written, with a sentence, exactly
  like a used-up turn quota.

### Schema

```sql
ALTER TABLE owner_providers ADD COLUMN gas_tokens bigint;          -- NULL = no paddle on this tank
ALTER TABLE roles           ADD COLUMN gas_metered boolean NOT NULL DEFAULT false;

-- inference_usage grows the resolution eino actually gives us, and a provider link
ALTER TABLE inference_usage ADD COLUMN provider_id uuid REFERENCES owner_providers(id) ON DELETE SET NULL;
ALTER TABLE inference_usage ADD COLUMN cached_tokens int NOT NULL DEFAULT 0;
ALTER TABLE inference_usage ADD COLUMN billable boolean NOT NULL DEFAULT true;  -- byoai → false
```

### The one real difference from turns

Messages are permanent; **`inference_usage` is a 7-day table** (`db/queries/stats/inference_usage.sql:20`
deletes rows older than 7 days at boot). Derived counting over a pruned table means fuel grows back
by itself. Fix, in the same spirit as turns (keep the rows, derive the number):

```sql
DELETE FROM inference_usage
WHERE created_at < now() - interval '7 days'
  AND NOT billable_against_gas;      -- rows a metered provider is accountable for are kept
```

i.e. the prune keeps what a gas sum needs and drops the rest. The dashboard stays a 7-day window; the
gas sum stays honest. No counter column, same as turns.

### The upstream ceiling (verified, and it kills an earlier plan)

I previously wrote "capture full resolution, meter on the sum". **The plumbing cannot carry it.**
`eino-ext/components/model/claude@v0.1.18/claude.go:1046`:

```go
promptTokens := int(resp.Usage.InputTokens + resp.Usage.CacheReadInputTokens + resp.Usage.CacheCreationInputTokens)
```

By the time usage reaches us it is already summed. `schema.TokenUsage` exposes `PromptTokens` (summed),
`PromptTokenDetails.CachedTokens` (cache-read only), `CompletionTokens`, `TotalTokens`;
`CacheCreationInputTokens` is unrecoverable from those, and `CompletionTokensDetails.ReasoningTokens`
is not populated by the claude adapter. Our own path then narrows three more times:
`accumUsage` (`agent_loop.go:212`) takes two fields → `RecordUsage(model, in, out)` takes two
parameters → `inference_usage` has two columns.

**Decision: accept eino's resolution** (prompt-total + cached + completion). Writing our own Anthropic
adapter to recover `cache_creation` buys nothing until someone asks a question that needs it — the
same call turn accounting made when it declined to weight turns.

### Code

- **`internal/conversation/usecase/visitor_gas_quota.go`** (new) — a mirror of `visitor_turn_quota.go`:
  `EnforceGasQuota(ctx, deps, in) error`, returning `nil` / `ErrGasExhausted`. Called from the same
  place `EnforceTurnQuota` is called, right next to it.
- **`agent_loop.go:212 accumUsage`** — also accumulate `PromptTokenDetails.CachedTokens`.
- **`RecordUsageFunc`** — grows to a struct argument (`model, provider_id, in, out, cached, billable`);
  a two-parameter signature is what pinned the resolution in the first place.
- **UI** — the visitor sees the same "you can't send this" shape the turn quota already produces;
  the owner sees remaining fuel per provider in the AI-provider panel.

### Tests

1. role with `gas_metered = false` → **no gas query is issued at all** (assert on the DB call, not on
   the outcome; "unmetered behaves like today" must be structural, not configured).
2. tank at 0 → the visitor's next send is refused **before** the message row is written, and the
   message the visitor sees contains no jargon.
3. two roles on one provider → spending through role A reduces what role B has (one tank).
4. byoai turns never touch the tank.
5. a usage row older than 7 days that a metered provider is accountable for **survives the prune**;
   an unmetered one does not.
6. the tank is refilled → sending works again.

---

## #8 — Instant grep: a second search tool, never-miss, alongside Meili

### Today

`internal/corpus/search/search.go` opens with the invariant that makes this safe:
*"Postgres 是 source-of-truth, meili 是派生投影:写路径同步 upsert/delete"*. Index maintenance is
already factored (`corpus/usecase/corpus_index.go`: `IndexNote` / `DeleteNote` / `ReindexOwner`), and
the retrieval capability already ships **seven** tools from one sandboxed plugin
(`mcp-servers/retrieval/main.go:37-43`), each backed by a named host op declared in
`backend/capabilities/corpus.retrieval/manifest.yaml`:

```yaml
host_ops: [corpus_search, corpus_read, corpus_list, corpus_links, corpus_map, corpus_resolve, corpus_peek]
```

with the host side of the wire in `corpus/usecase/corpus_index_socket.go:61`.

### Target (decided 2026-08-06)

**Neither channel gives way.** Two tools, two promises, each stated in its own description; the agent
picks:

- `corpus_search` (Meili) — typo-tolerant, prefix, instant. *"Find notes about X."*
- `corpus_grep` (new) — literal / regex, **never-miss**. *"Every place this exact string appears."*

The tool description is a first-class artifact here, not blurb: if the two descriptions do not make
the difference in guarantee obvious, the agent cannot choose correctly, and the whole point is lost.

### Why never-miss is a property, not a claim

A trigram (here: sparse variable-length n-gram) index can only ever produce **extra** candidates: any
document containing the pattern necessarily contains every n-gram of the pattern, so it is in the
posting-list intersection. False positives are removed by running the real regex on the candidates.
"If it exists, it is found" is arithmetic — not a ranking heuristic. That is the structural difference
from every vector-retrieval competitor, and it is the reason this is worth building at all.

### Staging (the note's own honest accounting)

Under ~1GB, plain ripgrep over the corpus is already milliseconds. So:

- **Stage 1** — `corpus_grep` as a tool, implemented by a straight scan over the owner's notes with
  the ACL filter that `corpus_search` already applies. Correct, never-miss, no index. Ship this.
- **Stage 2** — a sparse n-gram index as a **second derived projection** next to Meili (same
  `IndexNote` / `DeleteNote` / `ReindexOwner` hooks), swapped in behind the same tool when corpus size
  or QPS asks for it. Postgres stays the source of truth; a broken projection is rebuildable.

CJK falls out for free: Han characters are individually high-specificity, so "adapt n per script
(zh 1–2, en 3+)" comes out of the frequency weighting rather than being special-cased — **but the
weight table must be built from prose, not from code**.

### Code

- `mcp-servers/retrieval/main.go` — an eighth tool, `corpus_grep`, with a description that states the
  guarantee ("literal/regex; every match is returned; use when the exact words matter").
- `backend/capabilities/corpus.retrieval/manifest.yaml` — `corpus_grep` added to `host_ops`.
- `corpus/usecase/corpus_index_socket.go` — the host handler, ACL-scoped exactly like
  `runCorpusSearch`.
- `corpus/search/grep.go` (new) — stage-1 scan; stage-2 index later, same interface.

### Tests

1. a string that Meili's tokenizer misses (mid-word substring, punctuation-adjacent, a CJK bigram
   straddling a segmentation boundary) → `corpus_grep` finds it, and the test **also** asserts
   `corpus_search` does not — that contrast is the reason both exist.
2. ACL: a note outside the session's scope never appears in grep results (same fixture as the
   `corpus_search` ACL test — the new tool must not become a second, weaker door).
3. regex metacharacters are honoured, and an invalid pattern gives a human error, not a 500.
4. never-miss property test: generate N notes, pick a random substring of one, assert it is found —
   run it over the whole corpus fixture, not one note.
5. both tools are listed to the agent with descriptions that differ (a golden-snapshot test of the
   two descriptions, so nobody edits one into the other's promise).

---

## #10 — Multilingual: render N-language notes per the vault's sync contract

### Today, and the number that changes the risk

**596 notes in the vault carry a `> [!i18n]` block; 595 declare `langs: [en, zh]`.** Multilingual is
this vault's norm, not an edge case: the renderer change is a site-wide change, and a mistake is
visible 596 times. There is **no three-language note anywhere** — so N>2 is untested by the material,
and the e2e fixture has to invent one.

The two paths this rides on both exist: `app/src/components/page/markdown-callouts.ts` (blockquote →
`.callout[data-callout=…]`, matching Obsidian's DOM so the owner's snippets hit the same selectors)
and `backend/internal/corpus/obsidian/sync_note.go` (`parseCorpNote` / `parseFMLines` /
`listFieldOf`).

### Decided (owner, 2026-08-05 / 08-06)

1. **Titles live inside the panes**; the `i18n-t` span mechanism is retired (fewer HTML constructs, the
   title is not written twice, we never touch raw HTML).
2. **The visitor's language is the agent's call** — no site-locale auto-selection.
3. **slug = the `lang` filename; language is a query parameter**, not a path segment (not every note
   has the same language set, so `/zh/...` breaks).
4. **N is unbounded.** The lint's `2 ≤ len(langs) ≤ 3` is not a design — it is
   `i18n-switch.css:51-53` hand-writing three `nth-of-type` rules. We render our own switcher.
5. **`?lang=de` on a note that has no German → fall back to `lang`** (the identity language), not
   `langs[0]`.

### The minimum form

Frontmatter is optional. The nested callout is the whole contract:

```markdown
> [!i18n]
> > [!lang] en
> > # Title
> > ...
>
> > [!lang] zh
> > # 标题
> > ...
```

`langs` is redundant with the panes; the button row is Obsidian presentation; `aliases-*` serves link
resolution (#20), not rendering; missing `lang` → the first pane's code.

### A fifth key I did not know about: `lang-labels`

`raw/i18n-template.md:95` declares it — parallel to `langs`, giving the **button text** per language.
It is checked by no lint and used by zero notes, but it answers exactly the question our own switcher
raises. Rule: uppercase the code (`fr`→FR), with built-in labels for non-Latin scripts (`zh`→中文),
overridden by `lang-labels` when present. The vault already decided this; do not invent a second rule.

### Bringing `i18n-lint.py` in: a triage, not a port

Of its 20 rules, half guard the **CSS switcher** and die with decisions 1 and 4:

| Rule | Fate |
|---|---|
| E0 (block without `langs`) | drop — the minimum form is zero frontmatter |
| E1 (`langs` without a block) | keep, as a diagnostic |
| E2 (`[!i18n]` outermost; `[!lang]` only inside) | keep — an orphan pane renders as a plain callout |
| E3 counts | split: panes-vs-`langs` kept (mismatch → trust the panes); radios dropped; the 2–3 ceiling dropped |
| E4, E5 (`checked` first, radio group names) | drop — pure CSS mechanics |
| E6 | keep "no empty pane" and "no depth-1 content that belongs to no language"; drop the button-row rule |
| E7–E11 (identical links / embeds / math / code / structure across panes) | keep, **as warnings** — translation quality, not a rendering prerequisite |
| E12, W3 (title spans) | delete — titles moved into the panes |
| E13 (each pane declares its code) | keep, temper changed: mismatch → trust the pane, warn |
| E14, E15 (`aliases-*` codes; flat `aliases` = union) | keep as warnings — they serve link resolution |
| E16 (`lang` declared, ∈ `langs`) | keep — `lang` is the fallback target |
| W1, W2 (short pane, differing numbers) | keep as warnings |

Two parser details the lint learned the hard way and we must copy: track fenced code so a `[!i18n]`
inside a tikz block is not a block, and only treat depth-2 `[!lang]` as a pane — panes legitimately
contain further callouts (`i18n > lang > tip` is in the template).

### One implementation, four consumers

```
i18n.Validate(frontmatter, body) → []Diagnostic
   ├─ MCP write op        reject + say what is wrong + include a copyable minimal example
   ├─ corpus.check_i18n   validate without writing (what the owner's agent calls first)
   ├─ obsidian-sync       accept + surface diagnostics in the admin sync panel
   └─ renderer            decide whether to fall back to single-language
```

Two intakes, two tempers (decided): the **MCP write op refuses** (an agent that gets an error can fix
it and retry); **sync accepts** (it is a mirror — refusing means the owner loses content). Guidance
lives in the error message, not in the tool description: descriptions are paid for on every call and
are routinely ignored, so the description says one sentence ("the body may be multilingual; if it is
malformed you will be told how to fix it") and the *error* carries the example.

Diagnostics must be visible in the product. An owner whose bilingual note silently renders as one
language is in the same position as a sandbox that fails to start and logs nothing:

> `dynamics-to-a-fixed-point.md` — declares langs [en, zh, ja] but only 2 panes were found; rendered
> as single-language `en`.

### Tolerance table (awaiting the owner's nod)

| Malformed input | What we do |
|---|---|
| no `langs` | infer from the panes |
| `langs` disagrees with the panes | **trust the panes** (each declares its own code); warn |
| duplicate pane code | keep the first; warn |
| a single pane | render monolingual, no switcher |
| `[!lang]` outside `[!i18n]` | render as a plain callout; do not crash |
| unknown code (`jp`, `fr-CA`) | render it — it is a *code*, we do not need to recognise it |
| button row present / absent | ignore either way |

The line: **infer what is missing, never silently rewrite what is stated** (mismatch → report), and
**never attach a pane to the wrong language label** — fall back to monolingual instead of guessing.

### Rendering

1. frontmatter → `langs` / `lang` / `lang-labels` / `aliases-*`, all optional
2. body through the **existing** mdast pipeline (`markdown-callouts.ts` — do not build a second one):
   `[!i18n]` → drop the button row → splice in only the requested locale's `[!lang]` subtree
3. prose **outside** `[!i18n]` is language-neutral and always shown — which is why a note **cannot** be
   split into N documents (that also answers the Meili question: N docs would duplicate the neutral
   prose N times)
4. the title is the `#` inside the chosen pane
5. degraded: validation fails → whole note rendered in `lang`, plus a diagnostic

### Tests (designed to be able to go red *after* the feature works)

The characteristic false green: `expect(getByText('The whole edifice')).toBeVisible()` passes under a
"both languages in the DOM, CSS hides one" implementation — which is exactly what copying Obsidian
produces.

1. default renders `lang`; the other language's prose has **`toHaveCount(0)`**, not `not.toBeVisible`
2. switcher lists `langs` in order; clicking 中文 shows zh, hides en, adds `?lang=zh`
3. **prose outside `[!i18n]` is present under both languages** — the most valuable one; it kills the
   two-documents model
4. **not one character of the button-row HTML appears** (neither as a control nor as text)
5. the title changes with the language
6. a note without `langs` renders exactly as today (regression insurance for the minority)
7. `langs` lists three, two panes exist → whole note in `lang`, no 500
8. `?lang=de` → falls back to `lang`, no error
9. one test per row of the tolerance table
10. `GET ?lang=zh` server-renders Chinese (crawlers and agents fetch this URL)
11. one `hreflang` per language, all pointing at the same slug with their own parameter
12. searching a Chinese title finds **one** hit, not N, and its URI is that one slug
13. the agent's context contains **one** language's prose — assert it is not fed twice, do not assert
    which one it picked (model judgement drifts)
14. the agent can see which languages the note has (otherwise it cannot "decide for itself")
15. a malformed multilingual note through the MCP write op → **rejected**, error names the problem and
    carries a minimal example, and the note is **not created**
16. the minimum form (nested callouts, zero frontmatter) → accepted
17. `corpus.check_i18n` returns the **same** diagnostics as the write op, and writes nothing
18. a malformed note through sync → **accepted**, and the diagnostic is visible in the admin panel

The e2e vault fixture needs a real multilingual note shaped like the live sample — **several `[!i18n]`
regions in one note with neutral prose between them** — or test 3 cannot fail. Add a three-language
note too: the vault has none, so N>2 is otherwise untested.

### Vault-side follow-ups (the owner's files, not the product)

- 3 remaining notes still using title spans (capsocket · factor-mining-for-content ·
  expectancy-disconfirmation), plus the template's title section
- delete lint rules E12 / W3, and `i18n-switch.css:78-83`
- **`vault-i18n-sync-contract.md` is now stale**: it states `langs[0]` as the default shown (line 20,
  line 49 — overridden to `lang`) and says the lint means "StandMeet may parse trustingly" (line 12 —
  false for every other owner's vault). Implementing from the contract as written produces the wrong
  fallback.

---

## Order

`#6 → #7` is a hard dependency (a paddle needs a tank to sit on). `#8` and `#10` are independent of
both and of each other. `#5` stays last by the owner's instruction.
