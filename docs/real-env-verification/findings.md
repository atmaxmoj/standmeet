# findings — TEMPLATE

<!-- ─────────────────────────────────────────────────────────────────────────
COPY THIS FILE INTO THE ROUND DIR TO START A ROUND'S LEDGER:

    cp docs/real-env-verification/findings.md e2e/manual-runs/<round>/findings.md

A defect found while driving a round is written in THAT ROUND'S `findings.md`,
next to its `runsheet.md`, its `trajectory/` and its `shots/`. The evidence and the
record live together, so a row can name a screenshot without a path that leaves the
directory.

This file stays a template. Do not append findings here.

RULE 1 — one row is one defect. Split any row whose summary says "and".
  Two defects that share a fix are still two rows. Two rows that share an id are one lie.

RULE 2 — the id is `F-<letter>-<n>`, allocated once and never reused.
  The letter groups by area (A agent/chat, C connector, D data/quota, E jobs, F marketplace,
  L corpus/vault, …). Reusing a retired id makes two different defects look like one history.
  Before allocating, grep the round ledgers for the highest `F-<letter>-` in use.

RULE 3 — write the row so someone who was not there can act on it.
  Name the observation, then the attributed line, then the fix. In that order.
  "It's broken" is not a finding. "`ChatRoom.tsx:210` passes the ghost as a placeholder,
  and a placeholder does not wrap" is.

RULE 4 — attribute to a line, not to a file or a feeling.
  `file.go:118` with the reason it is that line. If the reason is a comment, quote it —
  a comment that states the invariant is stronger evidence than a paraphrase.

RULE 5 — record what you nearly got wrong.
  A near-miss (a finding you were about to log and then disproved) belongs in the round's
  trajectory, and a corrected attribution belongs in the row itself. Both are cheaper to
  read than to re-derive.

RULE 6 — a row is not closed until ⑤.
  ④ is "the code changed". ⑤ is "I looked at the real environment again and it is true".
───────────────────────────────────────────────────────────────────────── -->

## The five steps

A defect goes red → green through five steps, in order. **No step may be skipped**, and
③ may never be skipped to reach ④ faster.

| step | means |
|---|---|
| ①🔴 | reproduced by hand in the real environment |
| ②🎯 | attributed to a specific line, with the reason it is that line |
| ③🧪 | an e2e written **first** and **proven red** on the unfixed code |
| ④🟩 | the code changed and the e2e went green |
| ⑤🙌 | driven again in the real environment, by eye — **this is what closes it** |

### Status options — every step takes exactly one

| glyph | means | when to use it |
|---|---|---|
| ⬜ | not done | the default; nothing has happened on this step yet |
| ✅ | done | ①: reproduced · ②: line named · ③: red proven · ④: green · ⑤: re-verified by eye |
| 🚧 | in progress | started and interrupted. Say in the row what is left |
| 🔷 | not applicable | this step cannot apply here. **Say why in the row** — an unexplained 🔷 reads as a skip |
| 🚫 | blocked | cannot proceed without something outside this session. **Name the blocker and who owns it** |

Write all five, always, in order, e.g. `①🔴✅ ②🎯✅ ③🧪✅ ④🟩✅ ⑤🙌⬜`.
A missing step is indistinguishable from a forgotten one.

**When 🔷 is honest:** a defect found and fixed before this discipline existed (recorded
retroactively); a pure documentation or copy fix with no reachable assertion; a row that
records a decision rather than a code change. **When it is not:** "the e2e was hard to write".
That is ⬜, or 🚫 with the reason.

**When 🚫 is honest:** the step needs a credential only the owner can enter, a third-party
consent screen, a paid action, or a decision that changes what gets built. Name it:
`⑤🙌🚫 needs the owner to re-authorize Google`.

## Severity marks

Put these after the id, or leave it bare.

| mark | means |
|---|---|
| ⭐ | this one matters — it breaks a promise the product makes to its user |
| ⭐⭐ | it leaks data, loses data, or reaches a stranger |
| (bare) | a real defect with a bounded blast radius |

## The table

Copy this header into the round ledger and append rows under it.

| id | module · one line | detail | steps |
|---|---|---|---|
| F-X-0 ⭐ | `<module>` · what is wrong, in one clause | **What was observed**, with the screenshot that shows it. Then **②🎯** the attributed line and why it is that line. Then what makes it worse than it looks — the second-order consequence, if there is one. Then **the fix and its scope**, including what you deliberately did not fix and why. If an existing test was green through the whole life of this defect, say what it asserted instead — that is usually the more useful finding. | `①🔴⬜ ②🎯⬜ ③🧪⬜ ④🟩⬜ ⑤🙌⬜` |

<!-- Keep rows newest-first. A round ledger is read top-down by whoever picks the round up. -->
