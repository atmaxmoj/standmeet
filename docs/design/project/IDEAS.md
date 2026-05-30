# StandMeet — parked ideas (to integrate later)

## 0. FOUNDATION (the thing the competitors don't share)
StandMeet believes in **eclectic, not benchmarking.** Teal / career-ops / resume-template
sites all optimize the same axis — beat the ATS, match the JD, score higher on a rubric.
That's benchmarking: measuring a person against a fixed yardstick someone else holds.
We reject that. A person is an eclectic corpus — contradictory, unfinished, interesting
in the parts that don't fit a bucket. The product surfaces the WHOLE shape, lets the
visitor wander it, and answers in the owner's voice. The resume/job-loop is one outlet,
not the point. Never let a feature drift into "help you score higher" — every feature
should help you be MORE fully yourself, more findable as you actually are.

Running list of half-formed directions. Nothing here is built yet.

## 1. Resume = git (branching model)
⚠️ DECISION 2026.05.28 — full git metaphor (branch/commit/tag/cherry-pick/merge-conflict)
is TOO COMPLEX for the general user. Keep the underlying model (master + per-application
overrides + frozen-on-send snapshot) but DO NOT expose git vocabulary in the UI.
Surface it as plain language instead: "your full profile" (not main), "this version"
(not branch), "lock & send" (not tag), "pull this wording back into your profile"
(not cherry-pick), "your profile changed since you sent these 3 — update them?" (not
dirty/rebase). Teal's per-role bullet toggle (#8) is the right level of visible
complexity. The git-graph history view, if kept at all, is an optional "advanced" peek,
never the default surface.

- Master profile = `main` (private, everything incl. failed/unfinished)
- Each application = a branch (`branch/anthropic-staff-2026-05`)
- Save = commit (timestamped) · Send = immutable tag (the SHA the recruiter sees)
- Preview "diff vs master" mode: green added / red removed / yellow rewritten
- cherry-pick: pull a better-worded bullet back into master
- dirty state: master gained an entry after N branches were sent → "revisit?" prompt
- fork-from-branch: OpenAI version starts from the Anthropic branch, not master
- Implementation: master = canonical JSON; branch = override patch + ordering;
  sent = frozen snapshot. Three views (master / branch / diff) + history graph.

## 2. Application bundle, not just a resume
- What you send = resume PDF + cover letter + selected wiki-entry excerpts
  relevant to THIS application + a code (recruiter can chat the AI for follow-ups).
- Resume is the entry ticket; the bundle is the real answer.
- This is the inbound differentiator no resume-template site can do (they have no corpus).

## 3. Slant chips on resume composer
- Same data, different "slant": engineering / founding / advisory / press / academic.
- Switching slant reorders bullets, swaps summary, re-weights skills — data source unchanged.
- NOT template/color switching (that's what jiandanjianli etc. do, anti-our-aesthetic).

## 4. Per-bullet polish
- Each bullet gets a small "polish ↗" returning 2–3 tighter variants.
- Granular, not "regenerate whole resume."

## 5. Bullet ↔ wiki backlink
- Each resume bullet can cite a source (wiki/post entry).
- Recruiter hovers a "71%" claim → sees which original corpus entry it traces to.
- Impossible for template sites — requires the corpus.

## 6. From career-ops.org (santifer/career-ops) — studied 2026.05.28
Same worldview as StandMeet's job loop but OUTBOUND-shaped; local-first, MIT, anti-SaaS.
Worth absorbing:
- **Multi-dimensional rubric scoring** (replace single match% bar): six dims —
  match / north-star alignment / comp / cultural signals / red flags / global fit —
  1.0–5.0 score WITH citations to specific CV lines + JD requirements. <4.0 = don't apply.
  We're stronger here: cite to corpus entries as ground truth.
- **STAR story library**: accumulate 5–10 master STAR+Reflection stories across
  evaluations that answer any behavioral question. Auto-extract from corpus; reusable
  layer that both resume bullets and chat answers can pull from.
- **"filter, not auto-apply"** stance: owner makes every final call. Keep this.
- KEY INSIGHT: career-ops is outbound (helps you apply); StandMeet is inbound (lets
  people discover you via your corpus). The creator's actual offer came INBOUND — a CEO
  saw his systems-thinking. Building the tool was the proof of competence. StandMeet IS
  that inbound surface. Narrative: "not just better at applying — you make yourself
  worth an inbound."

## 8. From tealhq.com — studied 2026.05.28
Most design-mature in the space. "Career OS": job tracker + AI resume builder +
contact CRM + cover-letter gen under one login. Philosophy: job search = sales pipeline
(kanban: Saved/Applied/Interview/Offer/Rejected).
Worth absorbing:
- **Single career history → per-role bullet toggle** (on/off per target role). This is
  the LIGHT version of our resume=git idea (#1) — validates that "one data source +
  per-role toggle" is the right interaction. Our git model is a superset.
- **Each job carries the resume version used** — "always know which version went where,
  follow up with confidence." Surface resume_draft_id snapshot as first-class in
  applications section.
- **Full kanban funnel**: add interview/offer stages to listings (we have
  shortlist/applied/considering/pass — extend it).
- side-by-side resume version compare (same as our diff view).
Teal's weaknesses = our positioning wins:
- Reviews say AI bullets are generic / need human editing / templates ATS-iffy. Our
  anti-slop + corpus-grounded + cite-to-entry approach is the direct answer.
- "Management tool, not discovery tool" + explicitly no auto-apply (filter, not bot) —
  same stance as us + career-ops.
- Their match score = JD keyword overlap. Ours can be semantic + corpus-evidence (one
  dimension higher; career-ops also beats Teal here).
THREE-WAY MAP: Teal = cleanest pipeline mgmt (closed SaaS $29/mo) · career-ops =
strongest agentic eval (open CLI, local) · StandMeet = only INBOUND surface + corpus as
ground truth. Our unique layer: resume/application is just ONE OUTLET of the corpus;
people chatting the corpus is the INLET. Neither competitor has "let people discover you
through your thinking."

## 7. View Transitions / motion polish (partly shipped)
- Shipped: VT on blog/wiki article titles, hero prose; ink-link underline; char-stream.
- Not yet: magnetic cursor on composer ↵; ASCII loading grid; scroll-progress dotted line.

## 9. Agentic capabilities the chat could expose (brainstorm 2026.05.28)
Already built: per-code calendar booking, rich media in answers (image/gallery/file/code/
embed/quote/link), tool-call result blocks.
Candidates, ranked by fit-with-foundation (eclectic — "be more fully reachable / yourself",
never "score higher"):
- **intro brokering**: AI offers "want me to ask sijie to intro you to K.?" → routes to
  owner inbox; owner approves → warm intro fires. owner-gated, never auto.
- **scoped doc request**: gated ask → files a "release request" to owner queue instead of
  hard-refusing (softer than current redaction).
- **topic email opt-in**: "ping you when sijie publishes on retrieval?" → lead tied to the
  topic, not a generic list.
- **follow-up bundle**: end of convo → "send you the 2 essays we discussed + transcript?"
- ~~live availability (read-only)~~ — REDUNDANT, this is baked into calendar booking already.
- **visible research trace**: "let me pull the 3 entries that bear on this" (retrieve →
  rank → synthesize), matching SSE streaming.
- **cross-surface memory**: AI remembers /wiki questions when you land in chat (hang on
  SMSession).
- **owner-side agent (admin)**: "draft replies to the 3 access requests in my voice" /
  "summarize this week's conversations, flag anyone worth a real reply."
- **conditional reveal**: code rule "if visitor mentions X, unlock entry Y."
- **artifact on demand**: "put your eval thoughts in a one-pager" → assembles /output PDF
  live from corpus.
NON-GOALS (violate foundation): auto-apply, auto-DM recruiters, scrape/enrich the visitor,
gamified completeness scores, anything optimizing a benchmark.
