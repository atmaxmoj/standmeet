# Behavior Distillation System Design

## Abstract

From OS-level behavior monitoring to a persona model an agent can use. The core analogy: **the system is an apprentice that learns who the master is by watching how the master works**. A good apprentice does not record everything; it knows what to look at, how to look at it, and when to admit it does not understand.

The purpose of memory is not to describe the master; it is to **act like the master in new situations**.

---

## Design principles: how a good apprentice learns

| A good apprentice… | A bad apprentice… | System counterpart |
|-----------|----------|---------|
| Watches the whole job before summarising | Writes down each step as the teacher makes it | Cut chunks at task boundaries, not at fixed time intervals |
| Notices what the teacher did not do | Records only what the teacher did | Avoidance pattern detection |
| Watches how behavior changes under pressure | Watches only normal performance | Pressure state marking |
| Generalises "why" across situations | Records only "what" | Vector search + cross-domain association |
| Imitates, then compares the difference | Only watches, never practises | Active learning loop |
| Says "I don't know" when unsure | Makes up an answer | Confidence threshold + unanswered-question feedback |

### Theoretical foundations

| Discipline | Core insight | Corresponding design |
|------|---------|---------|
| Cognitive task analysis / RPD (Klein) | Experts decide by situation-action pattern matching, not decision trees | Playbook uses situation-action pairs, not if-else |
| Behavior cloning / DAgger | Corrections at the boundary are the most valuable data | During active learning, deliberately let the agent answer in uncertain situations |
| Tacit knowledge (Polanyi) | Most ability "cannot be put into words" | The raw summary pool is the only container for tacit knowledge |
| Situated learning (Lave & Wenger) | The same ability shows differently in different situations | Every playbook entry must carry a situation tag |
| Forgetting curve (Ebbinghaus) | Forgetting is a feature; every recall strengthens the memory | Memory consolidation: retrieved items stay, unretrieved items decay |
| Law of requisite variety (Ashby) | The controller's variety must be ≥ the variety of the controlled system | Playbook coverage metric: situations covered / kinds of situations actually met |
| Second-order cybernetics (von Foerster) | The observer changes the observed system; the controller also drifts | Periodically force fully automatic entries back to suggest mode to prevent execution drift |
| Positive feedback amplification (Wiener) | Do not only correct deviation (negative feedback); also amplify good changes | When an efficiency gain is detected, identify and lock in the new pattern |

---

## Overall architecture

```
┌──────────────────────────────────────────────────────────┐
│  Capture layer                                             │
│                                                            │
│  Screenpipe (breadth sampling, MIT license)                 │
│  Screen accessibility tree / OCR / audio Whisper            │
│  Event-driven capture, 5-10% CPU                            │
│                                                            │
│  Local tool logs (deep and precise, queried on demand)      │
│  git log / shell history / browser history /                │
│  file timestamps / docker logs / app usage                  │
└──────────────────┬───────────────────────────────────────┘
                   │ Raw event stream ~100MB/day
                   ▼
┌──────────────────────────────────────────────────────────┐
│  Signal filter layer                                       │
│  ├── Turning-point detection: correct / choose / order /   │
│  │   pause / abandon                                       │
│  ├── Avoidance detection: tools and paths available but    │
│  │   unused                                                │
│  ├── Pressure state marking: frequency spikes, skipped     │
│  │   routine steps                                         │
│  └── Task boundary detection: find where a whole task      │
│      starts and ends                                       │
│  Filters out 90% of the noise                              │
└──────────────────┬───────────────────────────────────────┘
                   │ High-signal events ~5MB/day
                   ▼
┌──────────────────────────────────────────────────────────┐
│  Multi-layer distillation pipeline                          │
│                                                            │
│  Second ──rules──→ micro-operation trait store              │
│  Task ───Haiku──→ methodology store (cut at task bounds)    │
│  Hour ───stats──→ rhythm pattern store                      │
│  Day ───Sonnet─→ decision style store (agent loop)          │
│  Week ───Opus──→ Playbook + Identity (agent loop)           │
│        │                                                    │
│        ├── Playbook awareness (index injected at start,     │
│        │   agent reads/writes on its own)                   │
│        ├── Drill-down check (index chain → Screenpipe →     │
│        │   local tools)                                     │
│        └── Association discovery (find_similar cross-domain │
│            search)                                          │
└──────────────────┬───────────────────────────────────────┘
                   │
       ┌───────────┼───────────┐
       ▼           ▼           ▼
   Playbook    Episodes     Meta
  (to repro)  (vector DB) (self-know)
       │           │           │
       └───────────┼───────────┘
                   ▼
┌──────────────────────────────────────────────────────────┐
│  StandMeet Agent                                          │
│  ├── Reproduce behavior: look up Playbook situation-action │
│  │   pairs                                                 │
│  ├── Values fallback: use Identity to reason about unseen  │
│  │   situations                                            │
│  ├── Answer on the spot: vector DB retrieves raw summaries │
│  ├── Confidence threshold: say "I don't know" when unsure  │
│  └── Active learning loop: agent draft vs user's actual    │
│      reply                                                 │
└──────────────────────────────────────────────────────────┘
```

---

## 1. Capture layer: breadth sampling + deep precision

### 1.1 Screenpipe (breadth sampling layer)

Glance at everything, event-driven, 5-10% CPU.

```
Captures: screen text (accessibility tree / OCR fallback), audio transcription (Whisper)
Frequency: capture on events, low-frequency fallback when idle
Output: timestamp + app name + window title + text content
Limit: it samples, so high-frequency behavior leaves gaps
```

### 1.2 Local tool logs (deep precision layer)

When Screenpipe has gaps, the higher-tier model queries the native logs of local tools on demand. **These logs are already on the machine: zero storage cost, accessed only when needed.**

The tools are not preset — the system **auto-discovers** the log sources available in the user's work environment:

```
Auto-discovery logic:
  ~/.gitconfig exists?         → register git_log(repo, since, until)
  ~/.zsh_history exists?       → register shell_history(since, until)
  ~/Library/Safari/ exists?    → register browser_history(since, until)
  Figma local cache found?     → register figma_history(since, until)
  Outlook/Calendar DB found?   → register calendar_events(since, until)
  Notion local cache found?    → register notion_changes(since, until)
  ...

Universal tools (every user has them):
  file_changes(directory, since, until)  → file modification records (from fs timestamps)
  app_usage(since, until)                → app usage time (native macOS API)
  clipboard_history(since, until)        → clipboard history (if enabled)

The essence: not "give engineers git log", but "see what the user has installed, and wire in the logs of whatever is there".
```

### 1.3 How the two layers work together

```
Scenario A (engineer): Opus drills down to check "what did he do between 10:32 and 10:35"
  Screenpipe: "10:32 VS Code commit 1857" → "10:35 commit 1845" (12 in between were missed)
  → git_log fills the gap → 8 refactors + 3 tests → "refactoring sprint"

Scenario B (lawyer): Opus drills down to check "what did she read between 14:00 and 14:30"
  Screenpipe: "14:00 opened Westlaw" → "14:30 opened Word and started writing" (what did she look up in between?)
  → browser_history fills the gap → 5 case-law pages + 2 statute pages → "she checks case law first, then statutes"

Scenario C (designer): Opus drills down to check "what did he change between 16:00 and 16:20"
  Screenpipe: "16:00 Figma opened" → "16:20 exported PNG" (how many versions in between?)
  → file_changes fills the gap → 7 autosaves → "repeatedly adjusting spacing and color"
```

Principle: **do not pour every tool log into the database up front. Give the agent access to the tools and let it fetch what it needs when it needs it.** (Peter's voice-message moment follows the same idea.)

---

## 2. Signal filter layer

### 2.1 Turning-point detection (what was done)

| Turning point | What it reveals | How it is captured | Signal strength |
|-------|---------|---------|---------|
| **Correct**: wrote → deleted → rewrote | Quality standards | Input-box diff | ★★★★★ |
| **Choose**: several options → picked one | Preference ranking | Search query + click | ★★★★ |
| **Order**: the path taken through the work | Methodology | App switch sequence + timestamps | ★★★★ |
| **Pause**: long inactivity → sudden big action | Depth of thought | Event interval analysis | ★★★ |
| **Abandon**: start → give up midway → change direction | Judgement | Files opened and closed quickly, large deleted inputs | ★★★ |

### 2.2 Avoidance pattern detection (what was not done)

"Never" reveals more about a person than "always".

```
Detect "available but unused" patterns:
  Engineer: has Docker installed but always uses the native environment; has Copilot but often dismisses it
  Lawyer: has Westlaw but always goes to Google Scholar first; has a case-law database membership but never uses advanced search
  Designer: has Figma plugins installed but draws everything by hand; has a Design System but always draws own components
  Marketing: has automation tools but always sends email by hand; the team uses a CRM but he only looks at Excel exports
  Universal: has Slack open but never starts a message, only replies (can appear in any profession)
```

Implementation: maintain a list of "known available tools/features" and count usage frequency periodically. Usage frequency near zero → mark as avoidance behavior.

### 2.3 Pressure state marking

Habits dropped under pressure = learned. Habits kept under pressure = internalised.

```
Pressure signal detection:
  - Save/commit/send frequency suddenly doubles within the same period
  - App switching frequency suddenly rises (an anxiety signal)
  - Starts skipping steps normally taken
  - Continuous working time grows significantly (still working at 2am, which is not normal)

Effect on distillation:
  Normal behavior → the main source for the Playbook
  Behavior under pressure → marked separately, to tell "true character" from "learned discipline"

Examples:
  Engineer: runs tests normally, skips them under pressure → testing is learned discipline
  Lawyer: checks case law three times per contract normally, only once before a deadline → due-diligence depth is discipline
  Designer: normally makes 3 options for the client to choose from, makes only 1 for a rush job → the multi-option strategy is discipline
  General inference: dropped under pressure = learned; kept under pressure = internalised
```

### 2.4 Task boundary detection

A good apprentice watches the whole job before summarising, not one note per step.

```
Boundary signals:
  - Large context switch (from project A to project B → new task)
  - git commit (usually marks the completion of an atomic task)
  - A change of work direction after a long pause
  - Closing one batch of tabs/files and opening another

Implementation:
  The main cut is still by time (30-minute fallback)
  But if a task boundary is detected, cut at the boundary
  If a task runs 2 hours without interruption, let it become one long chunk
```

### 2.5 Low-signal behavior (discarded)

Routine typing speed, page scrolling, mouse movement paths, system notification pop-ups, back-and-forth switches between apps of < 3 seconds.

---

## 3. Multi-layer distillation pipeline

### Second level (micro-operation layer)

```
Observes: keystrokes, edits, adjustments after autocomplete, format fixes
Distils: work style, naming/wording preferences, tool fluency
Method: pure rule extraction (regex + diff), $0
Examples:
  Engineer: "He always renames the AI-completed `data` to a semantic name"
  Lawyer: "He always changes '应当' to '须'" (both mean "shall"; he prefers the terser legal form)
  Designer: "He always manually adjusts auto-aligned spacing to multiples of 8"
  Universal: "He never uses exclamation marks in email" ← avoidance pattern
```

### Task level (methodology layer)

```
Observes: how one complete task is carried out (cut by the task boundary detector)
Distils: problem-solving methodology, information-gathering strategy
Method: Haiku summarises the sequence, ~50 times/day ≈ $0.05/day
Examples:
  Engineer: "hits an error → Google → Stack Overflow → not satisfied → reads the source"
  Lawyer: "takes a case → reads the full contract first → marks unfavourable clauses in red → checks case law → reads it again"
  Marketing: "sees data drop → looks at competitors first → then channels → finally content"
  Under pressure: "skips the middle steps and asks ChatGPT directly" ← pressure mark
```

### Hour level (rhythm layer)

```
Observes: half a day of workflow
Distils: attention patterns, energy allocation, context-switch frequency
Method: mainly statistical analysis, $0
Example: "Between 9 and 12 in the morning he barely switches apps (deep work period)"
```

### Day level (decision layer)

```
Observes: a full day of behavior (all task-level summaries + rhythm stats + pressure marks)
Distils: priority judgement, time management, coping with pressure
Method: Sonnet analyses a daily report, once/day ≈ $0.03/day
Example: "When an urgent request comes in, he spends 20 minutes wrapping up the current work before switching"
```

### Week level (persona layer)

```
Observes: 7 daily report summaries + micro-operation trait stats + avoidance pattern summary
Distils: Playbook entries, values, character traits
Method: Opus analyses a weekly report, once/week ≈ $0.02/day
Tools:
  - read_summary(date) → read one day's daily report
  - drill_down(chunk_id) → drill down to task/second level
  - find_similar(behavior, time_range?) → vector search for similar behavior
  - git_log / shell_history / browser_history → precise queries against local tools
```

### Day and week levels: not a single LLM call, an Agent Loop

The second and task levels can be done with a single call — the input is clear and the output is determined. But the day and week levels are **exploratory analysis**: we do not know what matters today, so the model must first scan, form a hypothesis, then dig in to verify. A single prompt cannot hold all of a day's episodes (possibly dozens to hundreds), and even if it could, attention would be diluted.

This is the same insight as OpenClaw's agent loop: **complex tasks need a multi-turn LLM → tool_use → execute → result → LLM → ... loop**, not a single prompt → response call.

#### Day agent (Sonnet)

```
Day Distillation Agent (Sonnet)
  │
  ├── Input: today's date
  │
  ├── Tools:
  │   ├── query_episodes(date, filters?)       ← list the day's episodes by filter
  │   ├── read_episode(id)                      ← read one episode in detail
  │   ├── query_stats(date)                     ← the day's stats (hour-level rhythm data)
  │   ├── read_playbook(path?)                  ← read the current Playbook (check existing patterns)
  │   ├── query_history(pattern, date_range)    ← check whether history has a similar pattern
  │   ├── write_day_report(content)             ← write the daily report
  │   └── write_insight(content, confidence)    ← write a finding into episodes
  │
  ├── Agent Loop (multi-turn, typically 4-8 turns):
  │   Turn 1: query_episodes(today)
  │           → gets a summary list of 45 episodes
  │
  │   Turn 2: "8 are about the schedule, concentrated in the morning"
  │           → read_episode(id1, id2, id3)
  │           → sees the details: 9:00 asks about the schedule, 9:05 checks weather, 9:10 reads email
  │
  │   Turn 3: "This looks like a morning routine; check history"
  │           → query_history("morning+schedule", last_7_days)
  │           → finds the pattern on 5 consecutive days
  │
  │   Turn 4: "Confirmed as a stable pattern; check whether the Playbook records it"
  │           → read_playbook()
  │           → not there → write_insight("Morning routine: schedule→weather→email, for 5 days so far", 0.7)
  │
  │   Turn 5: "There are also 3 voice-message episodes, not seen before"
  │           → read_episode(id7, id8, id9)
  │           → all sent while walking (context: walking)
  │
  │   Turn 6: "First use of voice, and all while on the move"
  │           → query_history("voice", last_30_days)
  │           → confirmed as first time
  │           → write_insight("First use of voice messages, trigger: on the move", 0.5)
  │
  │   Turn 7: "Today there is one episode with a pressure mark"
  │           → read_episode(id12)
  │           → in the afternoon switched apps 15 times in a row, finally skipped tests and committed directly
  │           → write_insight("Skips tests under pressure", 0.6)
  │
  │   Turn 8: write_day_report(...)
  │           → combines all findings into the daily report
  │   Done.
  │
  └── Output:
      ├── Daily report (day-level summary, for the week-level Opus to read)
      ├── New insights (written to episodes/, with confidence)
      └── Playbook update suggestions (not applied directly; left for the week level to confirm)
```

#### Week agent (Opus)

The week level is more complex — it does cross-day trend analysis, drill-down checks, association discovery, and Playbook updates. Its tool set is richer.

```
Week Distillation Agent (Opus)
  │
  ├── Input: this week's date range
  │
  ├── Tools:
  │   ├── read_day_report(date)                  ← read one day's daily report
  │   ├── drill_down(episode_id)                 ← drill down to task/second-level raw data
  │   ├── find_similar(behavior, time_range?)    ← vector search for similar behavior (association discovery)
  │   ├── read_playbook(path?)                   ← read the Playbook
  │   ├── update_playbook(path, content)         ← update a Playbook entry
  │   ├── create_playbook(name, content)         ← create a new Playbook file
  │   ├── update_identity(section, content)      ← update Identity
  │   ├── read_meta(type)                        ← read confidence/gaps/staleness
  │   ├── update_confidence(trait, value)        ← update confidence
  │   ├── mark_episode_absorbed(ids)             ← mark episodes as absorbed (consolidation)
  │   │
  │   │ Local tools (auto-discovered, for drill-down checks):
  │   ├── git_log(repo, since, until)
  │   ├── shell_history(since, until)
  │   ├── browser_history(since, until)
  │   ├── file_changes(dir, since, until)
  │   └── ... (varies by person)
  │
  ├── Agent Loop (multi-turn, typically 8-15 turns):
  │   Phase 1 — Panoramic scan
  │   Turn 1: read 7 days of daily reports → read_day_report(mon..sun)
  │   Turn 2: read the current Playbook + confidence → read_playbook(), read_meta("confidence")
  │
  │   Phase 2 — Form hypotheses
  │   Turn 3: "Both Wednesday and Thursday have a 'skipped tests' insight"
  │           → drill_down(episode_id) → look at the raw context
  │           → git_log(repo, wed, thu) → confirmed: both are hotfix commits
  │           → hypothesis: "skipping tests during urgent fixes is a stable pattern"
  │
  │   Phase 3 — Cross-check
  │   Turn 4: find_similar("skipped tests", last_30_days)
  │           → finds 4 times in the past month, all in hotfix situations
  │           → hypothesis confirmed, confidence 0.85
  │
  │   Turn 5: "The morning routine has lasted 5 days"
  │           → find_similar("morning+schedule", last_30_days)
  │           → appears in 3 of the past 4 weeks → very stable
  │
  │   Phase 4 — Playbook update
  │   Turn 6: read_playbook("debugging.md")
  │           → a debugging file exists but has no "hotfix skips tests" entry
  │           → update_playbook("debugging.md", append a situation-action pair)
  │
  │   Turn 7: "Morning routine" is a newly found pattern, not in the Playbook
  │           → create_playbook("morning-routine.md", ...)
  │
  │   Phase 5 — Association discovery
  │   Turn 8: find_similar("chose the more constrained option")
  │           → across 5 technology-selection situations he chose the more constrained option
  │           → update_identity("values.md", "systematically prefers constraint > flexibility")
  │
  │   Phase 6 — Memory consolidation
  │   Turn 9: episodes absorbed into the Playbook → mark_episode_absorbed(ids)
  │   Turn 10: update confidence → update_confidence(...)
  │   Done.
  │
  └── Output:
      ├── Playbook updates (new entries + changes to existing entries)
      ├── Identity updates (if a new cross-domain pattern is found)
      ├── Consolidation marks (absorbed episodes can be cleaned up)
      └── Confidence refresh
```

#### Why it cannot be a single call

| | Single call | Agent Loop |
|--|---------|------------|
| Input volume | Must stuff in all episodes at once | Query the list first, dig in as needed |
| Attention | Long prompt → diluted attention | Each turn focuses only on the current sub-question |
| Strategy changes | Hard-coded in the prompt | Decides the next step from intermediate results |
| Verification | No verification step | Hypothesis → check → confirm/reject |
| Drill-down | Impossible | Calls local tools for precise queries when needed |
| Association | Impossible | find_similar cross-domain search |
| Cost | Fixed (possibly higher, because the prompt is long) | On demand (4 turns for a simple day, 15 for a complex one) |

This is the lesson of OpenClaw's "send a voice message" story: **give the agent tools and several turns, and it will find the solution itself.** Day- and week-level distillation is essentially "analysis"; analysis is exploration, and exploration needs an agent loop.

#### Error recovery

Same idea as OpenClaw's model fallback:

```
Day agent run fails:
  attempt 1: Sonnet → timeout (too many episodes)
  attempt 2: Sonnet → retry with a filter to narrow the scope
  attempt 3: downgrade to Haiku → only a statistical summary, no deep analysis
  → a daily report is always produced (lower quality, but nothing is lost)

Week agent run fails:
  attempt 1: Opus → API rate limit
  attempt 2: wait for cooldown → retry
  attempt 3: downgrade to Sonnet → shallow weekly report, drill-down checks deferred to next week
  → no effect on daily use; only the Playbook update is delayed by a week
```

### Playbook awareness: not a separate process, the agent's natural behavior

There is no need for a separate "persistent-level audit agent". Each Playbook file carries a description, and the coarse-grained agents (day-level Sonnet, week-level Opus) see the list of all Playbook files and their descriptions at start-up. **The agent decides for itself whether to read and whether to change.**

This is the same approach as OpenClaw's memory tools — OpenClaw does not run a scheduled "memory tidying process". It gives the agent `memory_search` / `memory_get` tools, and the agent looks things up during the conversation when it thinks it needs to. Memory updates also happen naturally during the conversation (write a file into the memory directory → a file watcher notices → automatic embedding).

#### Playbook file structure

Each Playbook file has a description in its header so the agent can quickly judge whether it is relevant:

```markdown
---
name: debugging
description: Investigation strategy when hitting a bug, tool choice, different handling for urgent/non-urgent cases
maturity: mature
last_updated: 2026-03-10
entry_count: 12
---

## Situation: urgent production bug
Gut reaction: check the logs first, not the code
...
```

#### Context injection when the agent starts

When a day- or week-level agent starts, the system prompt includes the Playbook index (only file names + descriptions, not the full text):

```
Your Playbook skill library (7 files):
  debugging.md        — investigation strategy, tool choice, urgent/non-urgent handling [mature, 12 entries]
  tech-selection.md   — technology selection preferences, constraint vs flexibility trade-off [mature, 8 entries]
  email-triage.md     — email classification and forwarding rules [developing, 5 entries]
  code-review.md      — review order, focus points [mature, 9 entries]
  morning-routine.md  — morning routine [nascent, 2 entries]
  client-comm.md      — client communication wording [developing, 3 entries]
  vendor-selection.md — vendor selection strategy [developing, 4 entries]

Use read_playbook(path) to read details, update_playbook(path, content) to update.
When you think a new skill file is needed, use create_playbook(name, content).
```

The agent sees a lot of debugging-related behavior in today's episodes → naturally calls `read_playbook("debugging.md")` → finds a new pattern → `update_playbook("debugging.md", ...)` appends an entry.

**No separate audit process is needed. While doing day/week analysis, the agent maintains the Playbook along the way.**

#### Why this beats a separate audit

```
Problems with a separate audit process:
  ├── Over-engineering: needs its own trigger, its own agent, its own tool set
  ├── Fragmented information: the audit agent has no context on current behavior, only the files
  ├── Wasted cost: a dedicated 25-turn Opus loop just to tidy files
  └── Wrong timing: once a month → either too early (not enough accumulated) or too late (already fragmented)

Advantages of Playbook awareness:
  ├── Happens naturally: the agent updates while analysing behavior, no extra process
  ├── Rich context: the agent is looking at today's/this week's episodes and knows where the Playbook needs changes
  ├── Continuous maintenance: maintained every day/week, never left until it is fragmented
  └── Zero extra cost: Playbook maintenance is a few extra turns in the agent loop, not a separate process
```

#### What about cross-month patterns?

"Of his 5 technology selections over the past 3 months, he chose the more constrained option 4 times" — the week-level Opus can see this kind of cross-month pattern; it just needs tool support:

```
Week-level Opus analysis:
  Turn 3: "This week he again chose the more constrained option in a technology selection"
          → read_playbook("tech-selection.md")
          → already has 7 entries of the same kind, spanning 3 months
          → "This is not a new finding this week; it is a long-term stable pattern"
          → find_similar("chose the more constrained option")
          → appears across technology selection + vendors + tool choice
          → update_identity("values.md", "systematically prefers constraint > flexibility")
```

Key point: **the Playbook itself is the cross-month memory**. Every entry carries a date and evidence references. When the week-level Opus reads the Playbook, it naturally sees that the file has been accumulating since 3 months ago. There is no need for a separate "persistent level" to do this — the Playbook files are the persistence layer.

#### Skill maturity: emerges naturally, no separate assessment

Playbook maturity needs no dedicated assessment process. Every time the agent updates the Playbook, it marks maturity automatically from the current state:

```
Maturity rules (written in the agent's system prompt):

nascent:    entries < 3 or average confidence < 0.6
developing: 3-8 entries, most confidence 0.6-0.8
mature:     entries > 8, most confidence > 0.8
mastered:   mature + has counterexamples + has pressure variants

After each update_playbook, the agent updates the maturity field in the frontmatter.
No separate assessment process is needed.
```

The skill maturity map is also a natural by-product — reading the Playbook file list shows each file's maturity:

```
  debugging:            ████████████░░ mature
  tech-selection:       ██████████████ mastered
  email-triage:         ████████████░░ mature
  client-communication: ████░░░░░░░░░░ developing
  morning-routine:      ██░░░░░░░░░░░░ nascent
  code-review:          ██████████░░░░ mature
  vendor-selection:     ████████░░░░░░ developing

  This is not an audit output; it is how the Playbook file list naturally looks.
```

### Cost

```
Second level: $0 (pure rules)
Task level:   $0.07/day (Haiku)
Hour level:   $0 (statistics)
Day level:    $0.03/day (Sonnet, 4-8 turn agent loop)
Week level:   $0.15-0.40/day (Opus amortised, 8-15 turn agent loop + Playbook maintenance)
────────────────
Total:  ~$0.25-0.50/day/user ≈ $8-15/month/user
```

---

## 4. Memory system: five kinds of memory, five kinds of storage

The human brain does not have one memory — it has five different systems working together. Agent storage should be the same.

| Human brain | Agent counterpart | Storage characteristics | Implementation |
|------|-----------|---------|------|
| Working memory | Current conversation context | Small, fast, lossy | In memory / session JSON |
| Procedural memory | Playbook | Executable, situated | Markdown file system |
| Semantic memory | Identity | Abstract, stable | Markdown file system |
| Episodic memory | Episodes | Concrete, ordered by time | Vector DB + JSONL |
| Metamemory | Meta | Self-aware, dynamic | JSON files |

### Storage structure

```
standmeet-memory/
│
├── playbook/                     ← procedural memory (core: situation-action pairs for reproduction)
│   └── (no preset directories — they emerge from the distillation process)
│       Once the system has observed enough behavior of the same kind, it creates a new file
│       e.g. an engineer may grow debugging.md, tech-selection.md
│            a lawyer may grow case-research.md, contract-review.md
│            a designer may grow layout-decision.md, client-feedback.md
│            a marketer may grow campaign-planning.md, competitor-analysis.md
│
├── identity/                     ← semantic memory (the explanation layer for the Playbook)
│   ├── values.md                  ← underlying values (constraint > flexibility, stability > novelty...)
│   ├── style.md                   ← surface style (naming, code format, tone)
│   └── rhythm.md                  ← rhythm (deep work periods, energy allocation)
│
├── episodes/                     ← episodic memory (vector DB)
│   ├── raw/
│   │   ├── 2026-03-05.jsonl       ← one per day; each line is a task-level summary
│   │   └── ...
│   └── index/
│       └── episodes.db            ← sqlite-vec or lancedb
│
├── meta/                         ← metamemory (self-knowledge system)
│   ├── confidence.json            ← confidence for each trait
│   ├── unanswered.json            ← questions others asked that could not be answered
│   ├── gaps.jsonl                 ← behavior observed whose reason cannot be inferred (source for proactive questions)
│   ├── corrections.jsonl          ← agent draft vs the user's actual reply
│   └── staleness.json             ← when each memory was last verified
│
└── context/                      ← working memory (current conversation)
    └── sessions/
        └── {session_id}.json
```

### Why the Playbook is the core, not Identity

```
Descriptive memory: "He prefers PostgreSQL"
  → asked "What database does your owner like?" → "PostgreSQL" → that's it

Reproductive memory: "When facing a database choice..."
  → asked "What database should a new project use?" → can reason to an answer the way he would
```

**The purpose of memory is reproduction, not description.** The Playbook (how to do it) is the lead; Identity (who he is) is the annotation.

### Playbook format: situation-action pairs (not decision trees)

An insight from cognitive task analysis (CTA): experts rely on pattern matching, not if-else.

Playbook files are created by the system — when week-level Opus analysis finds that a kind of behavior recurs (≥3 situations of the same kind), it creates a Playbook file for it. File names and categories are decided entirely by the model, not preset.

```markdown
# [name chosen by the system].md
# e.g. engineer → tool-selection.md
#      lawyer → case-research-strategy.md
#      designer → client-revision-handling.md
#      marketer → channel-budget-allocation.md

## Situation: [specific situation description]
Gut reaction: [the observed first reaction]
Why: [the reason inferred from behavior]
Confidence: 0.9

## Situation: [same kind, different conditions]
Gut reaction: [a different reaction]
Why: [different conditions lead to a different choice]
Confidence: 0.8

## Situation: [the other party makes a specific request]
Reaction: [behavior description]
Why: [the inferred reason]
Confidence: 0.7

## Underlying values
→ [the common thread generalised across situations]
→ [under what conditions he is flexible, under what conditions he holds firm]

## Counterexamples
[date] [behavior that breaks the usual pattern]
→ Boundary condition: [why this time was different]
→ evidence: task-XXXXXXXX-XXXX
```

Concrete examples — these are not preset; this is what they look like after they emerge:

```
A lawyer user's playbook/ might look like this:
├── case-research-strategy.md     ← how to research cases (case law first or statutes first)
├── contract-red-flags.md          ← what to watch for when reading a contract
├── client-communication.md        ← how to give a client bad news
├── deadline-triage.md             ← how to order conflicting deadlines
└── opposing-counsel-style.md      ← how to respond when opposing counsel is aggressive

A marketer's playbook/ might look like this:
├── campaign-planning.md           ← how to plan a new campaign
├── budget-allocation.md           ← how to split the budget
├── data-interpretation.md         ← how to judge when the data fluctuates
├── vendor-negotiation.md          ← negotiating prices with vendors
└── crisis-response.md             ← how to handle a PR crisis
```

### Why a Markdown file system

```
Database:
  SELECT * FROM traits WHERE category = 'coding'
  → flat, no hierarchy, adding a dimension means changing the schema

File system:
  ls playbook/
  → tech-selection.md  debugging.md  communication.md
  → natural hierarchy; adding a dimension means adding a file
  → LLMs understand file paths natively
```

And StandMeet already has a path-based content system (`/repo/<path>/`). The memory system reuses it directly — **memory is content, content is memory**.

### Lookup order when the agent runs

```
The other party asks a professional question (engineer: "How do I fix this bug?" / lawyer: "Is this clause risky?")

1. playbook/ → find the matching situation-action pair → answer by the pattern
2. meta/confidence.json → confidence for this domain is 0.8 → can answer confidently
3. Cite the situation and action in the answer

The other party asks a non-professional question: "What music does your owner like?"

1. playbook/ → nothing about music
2. identity/ → nothing
3. episodes/ vector search → finds raw summaries:
   "3/5 listened to 12 post-rock tracks", "3/7 listened to lo-fi while working"
4. meta/confidence.json → no such dimension
5. Prefix the answer with "From what I've observed" (tacit knowledge, emerging from episodes)

The other party asks a question outside the observed range: "What does your owner think of US-China relations?"

1-3 all have nothing
4. Reply: "I'm not sure about that; ask him directly"
5. Write to meta/unanswered.json → fed back as a distillation priority
```

---

## 5. Memory consolidation and forgetting

The raw summary pool (episodes/) cannot grow without limit. Search quality degrades as data volume grows.

The human brain's solution: **forgetting is a feature, not a bug.** Specific events (episodic memory) are consolidated during sleep into abstract patterns (semantic memory); the details are lost but the regularities remain.

### Consolidation strategy

```
0-30 days: keep everything (fresh, may be needed at any time)

30-90 days:
  Retrieved → keep (recalled = strengthened, the Ebbinghaus effect)
  Never retrieved → check whether the Playbook has absorbed it
    Absorbed → delete the original; the Playbook keeps the evidence reference
    Not absorbed → downgrade to a compressed version (300 characters → 50-character summary)

90 days+:
  Retrieved 2 or more times → keep
  Compressed version never retrieved either → delete

Keep forever:
  Items the Playbook cites as counterexamples (boundary conditions are precious)
  Calibration records from the active learning loop (every one is valuable)
  Items the higher-tier model marked as "interesting"
```

### Steady-state size

```
50 summaries per day
After 30 days ~30% kept (retrieved or not absorbed) = 15
After 90 days ~10% kept = 5

Steady state ≈ 30 days×50 + 60 days×15 + long term×5×months
     ≈ ~2,400 in the first few months, then ~300 more per year
Vector DB steady state ≈ 3,000-5,000 entries → search quality does not degrade
```

### "Sleep" = week-level Opus analysis

Run an Opus analysis once a week, doing three things at once:
1. Distil new Playbook entries / update existing entries
2. Mark absorbed episodes as eligible for cleanup
3. Refresh staleness.json (memories not verified for over 30 days are marked stale)

---

## 6. Index chain + drill-down to local tools

Every summary layer carries source reference IDs. Higher layers can drill down along the chain, and **the bottom layer is not Screenpipe events but local tools**.

```
Example 1 (engineer):
Weekly trait: "conditional TDD"  (confidence: 0.6)
  ├─ evidence: day-20260305 → "3 fixes, 2 wrote tests first"
  │    └─ source: task-1032 → screenpipe + git_log drill-down
  └─ evidence: day-20260307 → "changed code directly without tests" (pressure: true)
       └─ git_log confirms → context: "urgent hotfix, client waiting"
  → Correction: "TDD when not urgent, skipped when urgent → testing is discipline, not instinct"

Example 2 (lawyer):
Weekly trait: "habitually checks case law before statutes"  (confidence: 0.7)
  ├─ evidence: day-20260305 → "contract dispute, Westlaw first, then statutes"
  │    └─ source: task-0930 → browser_history drill-down
  │         → 3 case-law pages → 2 statute pages → wrote the opinion in Word
  └─ evidence: day-20260308 → "wrote the opinion directly without checking case law" (pressure: true)
       └─ browser_history → opened only 1 statute page
       → context: "filing deadline that day, no time to check case law"
  → Correction: "case law first is discipline, not instinct — skipped when time is short"

General structure:
  weekly trait → daily evidence → task source → screenpipe + local tool drill-down
  Cross-check multiple pieces of evidence, paying special attention to the difference between normal and under pressure
```

### The higher-tier model's full tool set

```
Distillation tools (fixed):
  read_summary(date)                    → read one day's daily report
  drill_down(chunk_id)                  → drill down to task/second level
  find_similar(behavior, time_range?)   → vector search for similar behavior

Local tools (auto-discovered, vary by person):
  Universal: file_changes / app_usage / clipboard_history
  An engineer may have: git_log / shell_history / docker_logs
  A lawyer may have: browser_history (Westlaw/case-law databases)
  A designer may have: figma_history / file_changes (.fig/.psd edits)
  A marketer may have: browser_history / calendar_events / email_folders

  At start-up the system scans the environment and registers the available tools.
  The higher-tier model does not need to know the user's profession — it uses whatever tools it has.
```

Screenpipe is the breadth sampling layer (glances at everything); local tools are the deep precision layer (dig in when needed). The two layers work together, with no need to preload data.

---

## 7. Association discovery

### No need to design curiosity; just give it tools

While analysing the weekly report, the higher-tier model naturally needs more examples.

```
Example 1 (engineer): Opus generalises "technology selection preference"
  → find_similar("chose the more constrained option")
  → returns the same pattern across 5 technical domains
  → WHY: "systematically prefers constraint — it is not that he doesn't know the flexible options; he actively avoids them"

Example 2 (lawyer): Opus generalises "case strategy preference"
  → find_similar("chose the more conservative legal argument")
  → returns: in contract disputes chose breach of contract over tort, in labour disputes mediation before arbitration, in IP cases a warning letter first...
  → WHY: "risk-averse — prefers predictable paths, does not make big bets"

Example 3 (designer): Opus generalises "layout decision preference"
  → find_similar("rejected the client's change request")
  → returns: refused to enlarge the logo, refused brighter colors, refused to add more text...
  → WHY: "guards negative space — would rather argue with the client than let the page get crowded"
```

Nobody wrote extraction rules for these insights. The WHY emerges from multiple WHATs — **whatever the profession, a person's decision patterns are consistent across situations**.

---

## 8. Active learning loop

### 8.1 Agent draft vs the user's actual reply (the DAgger principle)

```
The other party asks a question
  → the agent generates a draft reply (but does not send it)
  → the user occasionally comes online and replies personally
  → the system compares:
      Engineering case: agent "could be considered" vs user "No, latency will blow up"
      Legal case:       agent "this clause is risky" vs user "This must be deleted, non-negotiable"
      Design case:      agent "could try blue" vs user "Absolutely not, the brand color stays"
  → the diff shows: the agent lacks professional judgement and only gives vague suggestions
  → the calibration signal is written back to the Playbook + Identity
```

The DAgger algorithm from behavior cloning tells us: **boundary correction data is far more valuable than normal data**. We should deliberately let the agent answer in uncertain situations and wait for the user to correct it.

### 8.2 Unanswered questions fed back as distillation priority

```
The other party asks: "What does your owner think about AI safety?"
  → cannot answer → "Ask him directly"
  → recorded in meta/unanswered.json
  → next time the user is seen reading an AI safety article → distil this dimension first
```

**Questions that were asked but could not be answered are the best distillation priority signal.** The system does not need to distil everything — only the things people will ask about.

### 8.3 Proactive questions: filling observation blind spots

The system can see the results of behavior, but some decision processes happen entirely in the head — the screen shows only "did it", not "why". When the system detects such a gap, it asks the user proactively.

**How this differs from writing a daily report**: a daily report is an open-ended essay (the user writes whatever they want, usually filler). System questions are a precise interview — the system knows where the information gap is and asks about a specific decision.

```
Daily report: "Handled finance-related work today"
System question: "At 10:30 you told finance 'go with option two'. What is the difference between options one and two? How did you choose?"
```

#### Gap detection

```
Recorded in meta/gaps.jsonl:
  {
    "observed": "Closed Excel → emailed to go with option two",
    "gap": "Difference between options one and two? Basis for the choice?",
    "context": "task-20260311-1030",
    "asked": false,
    "priority": 0.9
  }
```

#### What is worth asking

```
High priority (ask proactively):
  A decision whose process cannot be seen → "You chose A over B; why?"
  Avoidance whose reason is unknown → "You have tool X but don't use it; is that deliberate?"
  Unusual behavior under pressure → "Today you skipped Y, which you usually do; was there no time, or did you think it unnecessary?"
  Repeated revisions → "You rewrote the opening four times; how does the final version differ from the earlier ones?"

Low priority (do not ask yet):
  Pure execution details → how a formula was tuned doesn't matter; which option was chosen does
  Rhythm gaps → why he doesn't read email in the morning is probably just habit
  Patterns that already have enough samples → the Playbook already has 5 situations of this kind, it doesn't need this one
```

#### Question frequency

At most 2-3 questions a day. More than that becomes another kind of daily report. Save them up and pick the highest priority. They can be pushed together after the user's workday ends ("There are 2 questions I'd like to ask you today"), or inserted when an idle period is detected.

#### How answers are integrated into memory

The user's answer is **the highest-quality distillation signal** — more precise than any behavioral observation, because it is the user stating the why in their own words.

Integration path:

```
1. Write immediately to episodes/ (as a special kind of summary)
   {
     "type": "user_explanation",        ← distinct from the observation type
     "question": "How did you choose between options one and two?",
     "answer": "Option one is cheaper but means switching vendors, and the hidden cost of switching vendors is too high",
     "source_gap": "task-20260311-1030",
     "timestamp": "2026-03-11T18:30:00"
   }
   → goes into the vector DB, retrievable by find_similar

2. Try to update the Playbook directly
   The system checks: is there an existing related file in playbook/?

   Yes → append a situation-action pair:
     ## Situation: two options, one cheaper but requires switching vendors
     Gut reaction: choose the expensive one, don't switch vendors
     Why: hidden costs (switching cost, ramp-up period, risk) > price difference
     Confidence: 0.7 (only one sample, so start low)
     Source: user's direct explanation, task-20260311-1030

   No → keep it in episodes and wait for more
     Once situations of this kind appear 3+ times (some perhaps from observation, some from questions),
     the week-level Opus creates a new Playbook file automatically

3. May trigger an Identity update
   If the answer exposes an underlying value:
     "hidden cost > visible cost" → write to identity/values.md
     "he systematically overestimates switching costs" → this is a cross-domain preference

   But Identity is only updated during the week-level Opus analysis, not immediately
   → prevents a single answer from over-influencing the persona model

4. Linked completion
   This answer also explains behavior observed earlier but not understood:
     "2/20 chose a provider 30% more expensive" (earlier marked unexplained in episodes)
     "3/5 vetoed the cheap option the intern found" (same)
   → find_similar("chose the more expensive option") → finds these
   → episodes that were unexplained now have an explanation
   → in the next week-level analysis, Opus sees 3 of the same kind → creates a Playbook file directly

5. Update meta/gaps.jsonl
   asked: true, answer_received: true
   → this gap is filled
   → the confidence of related traits in confidence.json goes up
```

#### Weight of user answers vs behavioral observation

```
WHY stated by the user:
  ✅ High precision (what he says is what he thinks — most likely)
  ❌ May be post-hoc rationalisation (people embellish their own decision processes)
  → confidence 0.7, needs later behavioral confirmation

WHY inferred from behavioral observation:
  ✅ No self-embellishment (behavior does not lie)
  ❌ The inference may be wrong (same behavior, different reasons)
  → confidence 0.5-0.6

When the two agree:
  → confidence goes straight to 0.9
  → this is the strongest distillation signal

When the two conflict:
  → mark as a conflict, don't rush to a conclusion
  → perhaps what he says is the ideal and what he does is the reality
  → this is itself a valuable insight: "He thinks he is X; his actual behavior is Y"
  → write to identity/values.md as a "self-perception bias"
```

#### Why this beats a daily report

```
A daily report is written by an employee for the boss → information flows upward as reporting → naturally embellished, trimmed, padded
System questions are a tool asking the user → information flows as teaching an apprentice → the user has no motive to lie

The problem with a daily report: the writer doesn't know what the reader needs
System questions solve this: the system knows exactly what information it lacks
```

---

## 9. The chunk boundary problem

No need to worry too much. **What is distilled is patterns, not content. Patterns are redundant.**

A person's methodology recurs. Miss one instance that spans chunks, and there will be another.

Low-frequency, high-value decisions (technology selection, once or twice a month) are covered by task boundary detection (2.4) + local tool drill-down (6) — Screenpipe may miss them, but git log will not.

---

## 10. Complete data flow

```
Capture layer
├── Screenpipe raw stream (breadth sampling, ~100MB/day)
└── Local tool logs (deep precision, queried on demand, zero pre-storage)
         │
         ▼
Signal filter layer
├── Turning-point detection (what was done)
├── Avoidance pattern detection (what was not done)
├── Pressure state marking (state changes)
└── Task boundary detection (natural cuts)
         │
         │ High-signal events (~5MB/day)
         ▼
Multi-layer distillation pipeline
├── Second level: rules → micro-operation traits
├── Task level: Haiku → methodology ──→ also written to the Episodes vector DB
├── Hour level: statistics → rhythm patterns
├── Day level: Sonnet agent loop → decision style + daily report
│        └── Playbook awareness (sees the index → reads if relevant → updates along the way)
└── Week level: Opus agent loop → Playbook + Identity + memory consolidation
         ├── Playbook awareness (index injected at start, reads/writes/maintains on its own)
         ├── Drill-down check (index chain → Screenpipe → local tools)
         ├── Association discovery (find_similar cross-domain search)
         └── Memory consolidation (absorbed episodes marked for cleanup)

Memory system
├── playbook/ (situation-action pairs, for reproduction, Markdown)
├── identity/ (values + style, for fallback, Markdown)
├── episodes/ (raw summaries, vector DB, emergence + tacit knowledge)
│   └── Consolidation: keep all for 0-30 days, by retrieval frequency for 30-90 days, clean up after 90+ days
│       Steady state ~3,000-5,000 entries
├── meta/ (confidence + unanswered questions + calibration records + freshness)
└── context/ (current session, not persisted)

Proactive question loop
├── Detect gaps → meta/gaps.jsonl
├── 2-3 high-priority questions per day → pushed to the user
├── User answers → written to episodes (user_explanation type)
├── Try to update the Playbook directly (single sample, low confidence)
├── find_similar links earlier unexplained episodes
└── Behavioral observation + user explanation agree → confidence goes to 0.9

Output to the Agent
├── Query Playbook → situation match → reproduce behavior
├── Query Identity → reason from values → fallback for unseen situations
├── Query Episodes → vector search → on-the-spot emergence
├── Query Meta → confidence threshold → say "I don't know" when unsure
└── Active learning → agent draft vs actual reply → continuous calibration

~$0.25-0.50/day ≈ $8-15/month/user (distillation cost, excluding the execution layer)
```

---

## 11. Execution layer

Distillation and memory solve "knowing how to do it"; the execution layer solves "doing it for him".

The architecture reuses OpenClaw's proven pattern directly: **agent loop + MCP tool calls**. The only difference is that OpenClaw is triggered by user commands, while StandMeet is triggered automatically by situation matching.

### Architecture

```
                    ┌──────────────────────────────────┐
                    │  Situation detection (Screenpipe  │
                    │  live stream)                     │
                    │  "A vendor quote email arrived"   │
                    └──────────────┬───────────────────┘
                                   │
                                   ▼
                    ┌──────────────────────────────────┐
                    │  Playbook match                    │
                    │  Look up playbook/ → a matching    │
                    │  situation-action pair?            │
                    │  confidence ≥ 0.95?                │
                    └──────┬───────────────┬────────────┘
                           │               │
                     confidence ≥ 0.95   confidence < 0.95
                           │               │
                           ▼               ▼
                    ┌─────────────┐  ┌─────────────────┐
                    │  Auto run    │  │  Suggest mode     │
                    │  agent does  │  │  drafts a plan    │
                    │  it directly │  │  for the user     │
                    │  notifies    │  │  runs after the   │
                    │  user after  │  │  user confirms    │
                    └──────┬──────┘  └────────┬────────┘
                           │                  │
                           ▼                  ▼
                    ┌──────────────────────────────────┐
                    │  Agent Loop (OpenClaw pattern)     │
                    │                                    │
                    │  System Prompt:                     │
                    │    Playbook situation-action pairs  │
                    │    + Identity style/values          │
                    │    + related Episodes (vector       │
                    │      retrieval)                     │
                    │                                    │
                    │  Tools (MCP):                       │
                    │    tools already on the user's      │
                    │    computer                         │
                    │                                    │
                    │  Loop:                              │
                    │    LLM → tool_use → call → result  │
                    │    → LLM → tool_use → ...          │
                    │    → until the task is done         │
                    └──────────────┬───────────────────┘
                                   │
                                   ▼
                    ┌──────────────────────────────────┐
                    │  Execution result → fed back to    │
                    │  the distillation system           │
                    │  User accepts? modifies? rejects?  │
                    │  → calibrate Playbook confidence   │
                    └──────────────────────────────────┘
```

### Trigger modes: three tiers

```
Tier 1: fully automatic (confidence ≥ 0.95 + user has authorised this kind of operation)
  Situation: "a vendor quote email arrived"
  Playbook: "forward to finance + tag 'to compare prices'"
  → just do it; afterwards show "Forwarded to finance" in the notification bar
  Suits: high-frequency, low-risk, extremely stable operations
  e.g. email classification and forwarding, schedule reminders, document filing, fixed-format report generation

Tier 2: suggest and confirm (confidence 0.7-0.95, or the operation has side effects)
  Situation: "a client asks for a discount"
  Playbook: "usually no proactive discount, but long-standing clients can get 5%"
  → draft a reply for the user; it is sent only after the user clicks confirm
  Suits: operations with room for judgement, external communication, anything involving money
  e.g. email drafts, plan suggestions, prioritisation suggestions

Tier 3: observe only (confidence < 0.7 or a completely new situation)
  Situation: a type never seen before
  → do nothing; just watch how the user handles it
  → the result enters the distillation pipeline to build up samples
  Suits: new situations, areas the Playbook does not yet cover
```

### Tool layer: MCP reuses the user's environment

There is no need to build a separate tool system for StandMeet. Anything the user can do on their computer, the agent can do through MCP:

```
Existing tool ecosystem (plug in directly):
  Email: read/write/forward/tag (Apple Mail / Outlook MCP)
  Calendar: create/edit/query events (Calendar MCP)
  Files: read/write/move/rename (File System MCP)
  Browser: open pages/fill forms/search (Browser MCP)
  Messaging: send/reply (Slack / Teams / WeChat MCP)
  Documents: read/write/format (Google Docs / Office MCP)

Difference from OpenClaw:
  OpenClaw: 54 bundled skills, general abilities
  StandMeet: the same MCP tools, but the agent's "how to use them" comes from the Playbook
            → not a general assistant, but "uses these tools the way you do"
```

### System prompt construction

On each execution, the system prompt is assembled dynamically:

```
You are the digital twin of {user name}. Handle the current situation as follows.

## Current situation
{situation description detected by Screenpipe}

## Related Playbook
{matching situation-action pairs retrieved from playbook/, with confidence}

## Behavior style
{relevant passages of identity/style.md}

## Underlying values
{relevant passages of identity/values.md}

## Similar history
{top-3 similar situations from vector retrieval over episodes/}

## Constraints
- For judgements with confidence < 0.7, say "I'm not sure" and suggest the user decide
- Anything involving money / external communication / permission operations must be confirmed by the user
- When done, briefly tell the user what was done
```

This prompt structure is essentially the same as OpenClaw's AGENTS.md — both set behavior boundaries for the agent. The difference is that OpenClaw's rules are written by people, while StandMeet's rules are distilled.

### Execution results fed back into distillation

The execution layer is not the end — execution results are high-quality input for the distillation system:

```
The user's reaction after automatic execution:

Accepted (unchanged)
  → that Playbook entry's confidence +0.02
  → the pattern is more solid

Accepted after modification
  → DAgger signal: diff between what the agent did and what the user changed
  → written to meta/corrections.jsonl
  → a situation branch is appended to that Playbook entry
  e.g. "forward to finance" changed by the user to "forward to finance + CC the boss"
  → new situation: "when the amount exceeds X, CC the boss"

Rejected
  → that Playbook entry's confidence -0.05
  → marked as needing more samples
  → if rejected 3 times in a row → the entry is downgraded to "suggest mode"

User did it themselves (the agent did not trigger but the user did it manually)
  → means situation detection missed it, or the Playbook does not cover it
  → written to meta/gaps.jsonl → candidate for a proactive question
```

### Safety boundaries

```
Never done automatically:
  ❌ Deleting files/emails (irreversible)
  ❌ Sending money-related content (transfers, quotes, contracts)
  ❌ Changing permissions/passwords
  ❌ Publishing content externally (social media, announcements)
  ❌ Operations not in the Playbook (no "creative execution")

Can be done automatically (after user authorisation):
  ✅ Email classification, tagging, forwarding (to internal people)
  ✅ Creating calendar events, setting reminders
  ✅ Filing and renaming files
  ✅ Information lookups (changing nothing)
  ✅ Generating drafts (not sending)
```

### Relationship to the distillation layer

```
Distillation layer: observe → learn → remember (Playbook + Identity + Episodes)
Execution layer: recognise situation → query memory → execute → result fed back to the distillation layer

The distillation layer makes the execution layer more and more accurate:
  Month 1: almost all tier 3 (observe only), occasionally tier 2 (suggest)
  Month 3: mostly tier 2, some tier 1 (fully automatic)
  Month 6: high-frequency operations all tier 1, only new situations are tier 3
  → the more it is used, the more the system acts like the user

The execution layer makes the distillation layer learn faster and faster:
  Each execution = one active experiment
  The user's reaction to the result = the most precise calibration signal
  → learns faster than pure observation, because there is feedback
```

### Cost

```
Execution layer cost depends on trigger frequency and task complexity:

Tier 1 (fully automatic, simple operations):
  Haiku does situation matching + 1-2 tool calls
  ~$0.001/run, 20 runs a day = $0.02/day

Tier 2 (suggest and confirm, medium operations):
  Sonnet generates a draft + user confirms + executes
  ~$0.01/run, 5 runs a day = $0.05/day

Execution layer total: ~$0.07/day

Plus the distillation layer at $0.25-0.50/day
────────────────
Whole system (personal): ~$0.32-0.57/day ≈ $10-17/month/user
```

---

## 12. Playbook rating system

### Core definition

**Learned = within the situation subdomain that a Playbook file covers, bisimulation distance → 0.**

Bisimulation distance cannot be measured directly — we cannot see the user's internal state S. We approximate it with four observable proxies, each corresponding to exactly one source of bisimulation failure.

### 12.1 The four rating metrics

#### Discovery rate decay d(t) (failure type I — convergence of the situation space)

The most critical metric. If never-before-seen situation variants still appear every week, the situation space I has not been explored enough, and learning cannot be complete.

```
d(t) = new situation variants this week / total episodes in this domain this week

d(t) → 0: the situation space has been explored enough
d(t) stays > 0.3: situations in this domain are still expanding; it cannot converge

The essence: it measures the entropy of I. Entropy near zero = the prompt (quotient operator) has partitioned this domain enough.
```

Examples:

```
debugging.md over four consecutive weeks:
  d = 0.6 → 0.4 → 0.2 → 0.05
  → converging; almost no new variants in week 4

client-comm.md over four consecutive weeks:
  d = 0.5 → 0.5 → 0.4 → 0.3
  → not converged; client situations keep producing new ones
```

#### Prediction accuracy p (failure type β — accuracy of the agent model)

```
p = Σ(accepted × 1.0 + modified × 0.5 + rejected × 0.0) / total_executions

With exponential time decay: recent executions weigh more.

Shadow mode (shadow accuracy):
  the agent did not actually execute, but generated a draft in the background
  the user did it themselves → compare the diff → shadow_accuracy
  this metric can be collected in observe/suggest mode too
```

#### Modification rate decay m(t) (failure type α — stability of user behavior)

```
m(t) = number of times the distillation system modified this Playbook file this week

m(t) → 0: user behavior in this domain is stable; each weekly analysis has little to change
m(t) suddenly spikes: the user is changing (new way of working/tools/team); bisimulation is breaking down

Note: this counts modifications by the distillation system, not manual edits by the user.
The user manually editing the Playbook is a different high-quality signal (similar to answers to proactive questions).
```

#### Boundary completeness b (failure type F — sufficiency of observation)

```
b = (has_counterexamples ? 0.5 : 0) + (has_pressure_variants ? 0.5 : 0)

No counterexamples = we don't know where the boundary is
  → possible catastrophic failure at the boundary
  → "He always picks PostgreSQL" — but under what conditions does he not? Unknown.

No pressure variants = we can't tell discipline from instinct
  → "He always runs tests" — internalised or learned discipline? Unknown.
  → dropped under pressure = discipline, kept = instinct
  → without this distinction, bisimulation granularity is not fine enough
```

### 12.2 Rating storage format

One rating record per Playbook file, stored in the `meta_ratings` table:

```json
{
  "ratings": {
    "debugging.md": {
      "discovery_rate": 0.05,
      "prediction_accuracy": 0.91,
      "modification_rate": 0.02,
      "boundary_completeness": 1.0,
      "sample_size": 47,
      "execution_mode": "auto",
      "last_verified": "2026-03-10",
      "history": [
        {"week": "2026-W08", "d": 0.6, "p": null, "m": 0.8, "b": 0.0},
        {"week": "2026-W09", "d": 0.4, "p": null, "m": 0.5, "b": 0.0},
        {"week": "2026-W10", "d": 0.2, "p": 0.72, "m": 0.3, "b": 0.5},
        {"week": "2026-W11", "d": 0.05, "p": 0.91, "m": 0.02, "b": 1.0}
      ]
    }
  }
}
```

`history` records a weekly snapshot of the metrics, used to watch the convergence trend. The week-level Opus updates it on every analysis.

### 12.3 Execution mode thresholds

The combination of four conditions decides the execution mode; missing any one blocks an upgrade:

```
auto:    d < 0.1  AND  p > 0.9  AND  m < 0.1  AND  b = 1.0  AND  sample ≥ 20
suggest: d < 0.3  AND  p > 0.7  AND  sample ≥ 5
observe: everything else
```

Why no condition can be dropped:

| Condition not met | Meaning | Risk |
|-----------|------|------|
| d ≥ 0.1 | The situation space is still expanding | On a new variant the agent handles it with the wrong pattern |
| p ≤ 0.9 | The agent model is not accurate enough | More than 1 in 10 executions goes wrong |
| m ≥ 0.1 | User behavior is still changing | What the Playbook records may already be out of date |
| b < 1.0 | The boundary is unclear | Normal cases are fine; boundary cases may be catastrophic |
| sample < 20 | Not enough samples | Not statistically meaningful |

### 12.4 Downgrade triggers

Upgrade slowly, downgrade fast — a conservative strategy, because a wrong automatic execution costs far more than one extra confirmation.

```
Immediate downgrade (auto → suggest):
  - any single reject
  - reason: β has a problem; the model's prediction in this situation is wrong

Review downgrade (auto → suggest, and mark for Opus review):
  - 3 modifies in a row (even with no reject)
  - reason: β has a systematic bias, not an accidental error

Observe downgrade (any mode → observe):
  - m(t) rises suddenly (defined as: m(t) > 3 × the average of the past 4 weeks)
  - reason: α is changing; the user's behavior pattern is shifting and the earlier bisimulation no longer holds

Active perturbation (auto stays, but temporarily drops to suggest for one check):
  - the entry has not been verified for 60 days (last_verified expired)
  - reason: von Foerster's second-order cybernetics — the controller drifts
  - frequency: at most 1-2 perturbations a day, no impact on experience
  - user confirms → last_verified refreshed
  - user modifies → drift found, Playbook updated, back to suggest
  - user rejects → the entry may be out of date, back to observe
```

### 12.5 When ratings are updated

```
Updated in real time:
  - prediction_accuracy: updated immediately after each execution (accept/modify/reject)
  - execution_mode: changed immediately whenever a downgrade triggers

Updated weekly (during the Opus analysis):
  - discovery_rate: only meaningful over a week of episodes
  - modification_rate: counted per week
  - boundary_completeness: Opus checks whether counterexamples or pressure variants were added
  - sample_size: accumulated
  - history: append this week's snapshot

Upgrade check (after the weekly update):
  - observe → suggest: check d < 0.3 AND p > 0.7 AND sample ≥ 5
  - suggest → auto: check all 5 conditions
  - an upgrade needs the conditions met for 2 consecutive weeks (guards against chance fluctuation)
```

### 12.6 Relationship to the distillation pipeline

The rating system is not a separate module — it is a natural product of the week-level Opus analysis. When Opus updates the Playbook each week, it updates the ratings along the way:

```
Week Distillation Agent (Opus)
  ...
  Phase 6 — Rating update
  Turn N: read_meta("rating")
          → compute d(t) and m(t) for each Playbook this week
          → check whether counterexamples/pressure variants were added → update b
          → check upgrade conditions
          → update_meta("rating", ...)
  ...
```

The execution layer reads the `meta_ratings` table to decide the three-tier trigger mode; it does no assessment of its own.

---

## 13. Cybernetic framework

The whole system is essentially a cybernetic system — it keeps effective control in an uncertain environment through feedback loops. Using the cybernetic framework explicitly exposes three design elements that pure engineering thinking tends to overlook.

### 13.1 Ashby's law of requisite variety: the Playbook completeness metric

> "Only variety can destroy variety." — W. Ross Ashby, 1956

The controller's (Playbook's) situation coverage must be ≥ the situation variety of the controlled system (the user's actual work). If it falls short, control is lost — the system can only observe, not execute.

```
Quantified:
  This week the user met 40 recognisable situations
  The Playbook covers 28 of them (confidence ≥ 0.7)
  → coverage = 28/40 = 70%

  What coverage means:
  > 90%: the system is close to a "digital twin"; it can do most things on your behalf
  70-90%: a useful assistant, but often meets things it can't do
  < 70%: still learning; its main value is observing and recording

  This number is itself a measure of product value.
  It can be shown to the user: "Your digital twin has learned 78% of your work patterns."
```

Variety has a second meaning — **whether the situation branches inside a Playbook are fine-grained enough**:

```
Coarse-grained (not enough variety):
  playbook/email-response.md has only 1 situation-action pair
  → every email is answered the same way → bound to go wrong

Fine-grained (enough variety):
  playbook/email-response.md has 12 situation-action pairs
  → distinguishes: superior/peer/client/vendor × urgent/routine/sensitive
  → each situation has different wording and handling
  → the variety matches the complexity of the real world
```

### 13.2 Second-order cybernetics: observation changes behavior, the controller drifts

> "The observer is not outside the system — the observer is part of the system." — Heinz von Foerster, 1974

**First problem: observation changes the observed.**

The user knows the system is learning their behavior. This can lead to:
- Positive: the user becomes more disciplined ("the system is watching, I'll be careful")
- Negative: the user performs work ("let the system learn that I'm diligent")
- The real effect may be small — after three months the user forgets the system is running, like forgetting the fitness band on their wrist

**Second problem: execution drift.** This one is more serious.

```
How drift happens:
  1. Playbook entry A reaches confidence 0.97 → upgraded to fully automatic
  2. The system executes entry A automatically; the user no longer does it personally
  3. 3 months pass, and the user's actual preference has changed
     (new vendor, team restructure, market change...)
  4. But Playbook entry A's confidence is still 0.97
     → because there is no negative feedback: the user stopped doing it, so there is no behavior data to correct it
     → the system keeps executing the old pattern
  5. Only when some execution result goes wrong does the user notice

  This is the core warning of second-order cybernetics:
  the controller (Playbook) and the controlled system (user behavior) decouple
```

**Countermeasure: active perturbation**

```
Anti-drift mechanism for fully automatic entries:
  Every 30 days, randomly pick 10% of the fully automatic entries
  → force them back to "suggest mode" once
  → the user has to take a look: "The system wants to forward this email to finance for you; confirm?"
  → user confirms → confidence refreshed (verified, not left over from inertia)
  → user modifies → drift found, Playbook updated
  → user rejects → the entry may be out of date, back to observe mode

  Frequency control:
  Not every entry every time (that would no longer be automation)
  But sampled verification — like an audit, not an approval
  The user is "perturbed" at most 1-2 times a day, with no impact on experience
```

### 13.3 Positive feedback: not only correcting, but amplifying good changes

Classical cybernetics focuses on negative feedback (correction). But positive feedback (amplification) is just as valuable.

```
Negative feedback (already present):
  the agent got it wrong → the user corrects → Playbook updated
  "Last time you forwarded it to the wrong person" → fixed

Positive feedback (new):
  a positive change in user behavior → the system detects it and locks it in
  "This week you handled quotes 40% faster than last week"
  → the system analyses the diff: the vendor qualification re-check step was skipped
  → two possibilities:
     a. the user found the step unnecessary (efficiency gain) → lock it in as a new pattern
     b. the user cut corners (quality drop) → do not lock it in, mark for observation
  → how to tell: look at the consequences. If nothing went wrong after skipping × 3 times → most likely a

  The value of positive feedback:
  not only "learn how you do things now"
  but also "learn what you are becoming"
  → the system can keep up with the user's evolution, not just freeze the user's past
```

### 13.4 The whole system from a cybernetic view

```
                    ┌─────────────────────────┐
                    │  Environment (the user's  │
                    │  work world)              │
                    └────────┬────────────────┘
                             │ Disturbances (new tasks, changes, pressure)
                             ▼
┌─────────────────────────────────────────────────────┐
│  Sensors (Screenpipe + local tools)                  │
│  → Ashby: sensor variety ≥ environment variety        │
│    is needed to capture enough signal                 │
└────────────────────┬────────────────────────────────┘
                     │ Observation
                     ▼
┌─────────────────────────────────────────────────────┐
│  Controller (distillation pipeline + memory system)   │
│  → Ashby: Playbook situation variety ≥ user behavior  │
│    variety                                            │
│  → von Foerster: the controller itself drifts and     │
│    needs active perturbation checks                   │
└────────────────────┬────────────────────────────────┘
                     │ Execution
                     ▼
┌─────────────────────────────────────────────────────┐
│  Actuator (Agent + MCP tools)                         │
│  → Negative feedback: execution error → correct       │
│    the Playbook                                       │
│  → Positive feedback: execution improves → lock in    │
│    the new pattern                                    │
│  → Second-order effect: execution changes the user's  │
│    behavior → back to the sensors to observe again    │
└────────────────────┬────────────────────────────────┘
                     │ Feedback
                     ▼
              Back to the sensors (closed loop)
```

---

## 14. Organisation-level recursion: from personal Playbook to organisational Playbook

Personal distillation runs **second → task → hour → day → week**, with the personal Playbook emerging from raw behavior.

The same recursion goes up one more level: the execution records of several people's personal Playbooks are the "raw behavior" for organisation-level distillation. **Personal distillation watches how one person repeatedly does things; organisational distillation watches how work repeatedly flows when a group collaborates.**

### Recursive isomorphism

```
Personal distillation               Organisational distillation
──────────────────────────────────────────────────────
Raw input: Screenpipe screen events  Raw input: each person's agent execution records
                                    "Zhang San's agent finished the data analysis at 10:00 and sent the output to Wang Wu"
                                    "Wang Wu's agent finished the proposal draft at 14:00 and sent it to Li Si for review"
                                    "Li Si manually changed three clauses at 15:30 and returned it to Wang Wu"

Signal filter: turning points /      Signal filter: flow anomalies / skipped roles / bottlenecks
avoidance / pressure

Second level → micro-operation traits (no counterpart; handled at the personal level)
Task level → methodology            Task level → the full flow path of one cross-person task
Hour level → rhythm                 (no counterpart)
Day level → decision style          Week level → pattern aggregation over all cross-person tasks in a week
Week level → personal Playbook      Month level → organisational Playbook
```

### Input to organisational distillation

Personal distillation reads raw events from Screenpipe. Organisational distillation reads events from the **execution layer's flow records**:

```
Each cross-person collaboration produces one flow record:

{
  "task": "Partnership proposal for a new client",
  "initiated_by": "Zhang San",
  "timestamp": "2026-03-11T09:00:00",
  "steps": [
    {
      "role": "data-analysis",
      "assignee": "Zhao Liu",
      "started": "09:15", "completed": "11:30",
      "mode": "auto",          ← completed fully automatically by the agent
      "output": "client-data-report.xlsx"
    },
    {
      "role": "competitor-research",
      "assignee": "Wang Wu",
      "started": "09:15", "completed": "13:00",  ← in parallel with the previous step
      "mode": "assisted",      ← drafted by the agent, confirmed after Wang Wu's edits
      "output": "competitor-comparison.md"
    },
    {
      "role": "proposal-writing",
      "assignee": "Wang Wu",
      "started": "14:00", "completed": "16:30",
      "mode": "assisted",
      "output": "proposal-v1.docx",
      "depends_on": ["data-analysis", "competitor-research"]
    },
    {
      "role": "legal-review",
      "assignee": "Li Si",
      "started": "16:45", "completed": "17:30",
      "mode": "manual",        ← done entirely by hand by Li Si
      "output": "proposal-v1-reviewed.docx",
      "corrections": 3          ← 3 changes
    },
    {
      "role": "revision",
      "assignee": "Wang Wu",
      "started": "17:30", "completed": "18:00",
      "mode": "auto",           ← the agent revised automatically from Li Si's annotations
      "output": "proposal-v2.docx"
    }
  ],
  "total_duration": "9h",
  "outcome": "sent_to_client"
}
```

### Organisational signal filtering

Recursively mirrors the personal-level turning point / avoidance / pressure detection:

```
Flow anomalies (counterpart of personal "turning points"):
  This proposal went out without legal review → why was it skipped?
  This data analysis was done by Zhang San himself, not Zhao Liu → why the change of person?
  Wang Wu's proposal was returned twice (usually 0-1 times) → a quality problem, or did the requirements change?

Skipped roles (counterpart of personal "avoidance patterns"):
  There is a legal role, but this kind of task never goes through legal → the team habitually skips legal review
  There is a data-analysis role, but Zhang San always does it himself → does Zhang San not trust Zhao Liu's analysis? Or is the communication cost too high?

Bottleneck detection (counterpart of personal "pressure marks"):
  Li Si's legal review always takes 1-2 days → every task's bottleneck is the same person
  Wang Wu was assigned 3 proposals to write at once → uneven load
  The average duration of some kind of task keeps growing → the process is degrading
```

### Organisational Playbook format

Recursively isomorphic to the personal Playbook format — situation-action pairs. Only the "action" is not what one person does but **which roles do what in what order**:

```markdown
# org-playbook/client-proposal.md (emerged, not preset)

## Situation: renewal proposal for an existing client
Roles: data-analysis(≥0.8) → proposal-writing(≥0.85) → pricing-approval(≥0.7)
Flow: data analysis (1 day) → proposal writing (1 day) → internal pricing approval (0.5 day) → send
Typical duration: 2.5 days
Confidence: 0.9 (done 11 times)

## Situation: first proposal for a new client
Roles: +competitor-research(≥0.7) + legal-review(≥0.85)
Flow: competitor research ∥ data analysis (1 day each) → proposal writing (2 days) → legal review (1 day) → internal review (0.5 day) → send
Typical duration: 5.5 days
Confidence: 0.85 (done 7 times)
Note: one more legal step than for existing clients — new-client contracts have no historical template

## Situation: urgent proposal (≤3 days)
Roles: same as "new client" but skips legal-review
Flow: data analysis ∥ competitor research (1 day) → proposal writing (1 day) → skip legal → send
Confidence: 0.7 (done 3 times)
Note: legal review skipped under pressure ← same logic as the personal pressure mark
Risk flag: in 1 of the 3 times, the client's legal team later returned it asking for added clauses

## Underlying organisational values
→ The renewal process is lean (the trust relationship is established)
→ The new-client process is complete (highly defensive)
→ Under urgency the legal step is sacrificed (speed > compliance, but with consequences)

## Counterexamples
2026-02-28 an existing-client renewal also went through legal review
→ Boundary condition: the contract amount was 3 times larger than usual
→ evidence: org-task-20260228-001
```

### Role ≠ job title, role = capability tag

Roles are mapped automatically from personal Playbooks, not entered by HR:

```
Zhang San has playbook/data-analysis.md (0.95)
  → Zhang San can fill the data-analysis role

Wang Wu has playbook/competitor-research.md (0.88)
  and playbook/proposal-writing.md (0.91)
  → Wang Wu can fill two roles

Li Si has playbook/contract-review.md (0.93)
  → maps to the organisational role legal-review

capability-map.json (generated automatically):
{
  "data-analysis":       [{"user": "Zhao Liu", "confidence": 0.95},
                          {"user": "Zhang San", "confidence": 0.82}],
  "proposal-writing":    [{"user": "Wang Wu", "confidence": 0.91}],
  "competitor-research": [{"user": "Wang Wu", "confidence": 0.88},
                          {"user": "Zhang San", "confidence": 0.65}],
  "legal-review":        [{"user": "Li Si", "confidence": 0.93}],
  "pricing-approval":    [{"user": "Zhang San", "confidence": 0.91}]
}

→ one person can fill several roles
→ one role can be filled by several people
→ matching looks at the confidence threshold + current load
→ legal-review has only Li Si → an organisational capability gap, flagged automatically (Ashby: not enough variety for this role)
```

### Organisational memory system (recursively isomorphic)

```
standmeet-memory/
├── users/
│   ├── zhangsan/
│   │   ├── playbook/           ← personal Playbook
│   │   ├── identity/
│   │   ├── episodes/
│   │   └── meta/
│   ├── lisi/ ...
│   └── wangwu/ ...
│
└── org/                         ← organisation level (isomorphic)
    ├── playbook/                ← organisational Playbook (collaboration flow patterns, emergent)
    │   └── client-proposal.md, incident-response.md, ...
    ├── identity/                ← organisational Identity (team culture/style)
    │   ├── values.md             ← "conservative, more review" / "fast, ship first and fix later"
    │   └── rhythm.md             ← "plan on Monday, release on Friday"
    ├── episodes/                ← organisation-level collaboration records
    │   └── raw/
    │       └── 2026-03-11.jsonl  ← each line is the full flow of one cross-person task
    ├── meta/
    │   ├── confidence.json       ← confidence for each collaboration pattern
    │   ├── gaps.jsonl            ← flow anomalies ("why was legal skipped this time?")
    │   ├── capability-map.json   ← role → people mapping (aggregated from personal Playbooks)
    │   └── staleness.json        ← freshness of collaboration patterns
    └── context/
```

### Organisational memory consolidation (recursively isomorphic)

```
Consolidation for organisational episodes is the same as at the personal level:
  0-30 days: keep everything
  30-90 days: keep the retrieved ones, clean up those absorbed into org-playbook
  90 days+: compressed version never retrieved either → delete

Steady state ≈ 500-1,000 entries (organisation-level tasks are less frequent than personal ones)

Confidence decay for the organisational Playbook:
  "This process was last used 3 months ago" → staleness mark
  → people may have changed, tools may have changed, the process may actually have changed
  → next time it triggers, drop back to "suggest mode" to re-verify
```

### Organisation-level proactive questions (recursively isomorphic)

The personal level asks the user "why did you do it this way". The organisation level asks **"why was this flow different from usual"**:

```
org/meta/gaps.jsonl:
{
  "observed": "The new-client proposal skipped legal review",
  "usual_pattern": "New-client proposals always go through legal-review",
  "gap": "Skipped because of urgency, or has the process changed?",
  "ask_who": "Zhang San",     ← ask the initiator
  "priority": 0.9
}

{
  "observed": "Data analysis was done by Zhang San, not Zhao Liu",
  "usual_pattern": "The data-analysis role is usually filled by Zhao Liu (0.95)",
  "gap": "Was Zhao Liu away? Or did this task have special requirements?",
  "ask_who": "Zhang San",
  "priority": 0.6
}

The answer integration path is the same as at the personal level:
  → written to org/episodes
  → try to update org-playbook (append a situation branch)
  → may find a new boundary condition
```

### The full flow when a task comes in

```
1. Task input
   "Client ABC wants a new partnership proposal before next Monday"

2. Look up the organisational Playbook
   org-playbook/client-proposal.md
   → matching situation: "first proposal for a new client"
   → roles needed: data-analysis + competitor-research + proposal-writing
               + legal-review + pricing-approval
   → usual flow: competitors ∥ data (1 day) → proposal (2 days) → legal (1 day) → approval (0.5 day)
   → but there are only 4 working days → triggers the situation "urgent proposal" → run more steps in parallel

3. Look up capability-map.json → match people
   data-analysis → Zhao Liu (0.95) or Zhang San (0.82)
   → Zhao Liu's current load: already has 2 tasks → assign to Zhang San
   competitor-research → Wang Wu (0.88)
   proposal-writing → Wang Wu (0.91)
   legal-review → Li Si (0.93) → he is the only one, irreplaceable
   pricing-approval → Zhang San (0.91)

4. Generate a flow plan (suggest mode, because the urgent situation has confidence 0.7)
   Day 1: Zhang San (data) ∥ Wang Wu (competitors)   ← in parallel
   Day 2: Wang Wu (proposal)                          ← depends on the first two steps
   Day 3: Li Si (legal) + Zhang San (pricing approval) ← legal and pricing can run in parallel
   Day 4: revise + send                               ← buffer

5. The initiator (Zhang San) confirms the plan
   → each person's agent receives its subtask
   → executes according to its own personal Playbook
   → outputs flow automatically to the next step

6. Flow complete → written to org/episodes → input for organisational distillation
```

### Organisation-level distillation pipeline

```
Task level (after each cross-person collaboration completes):
  Haiku summarises the flow
  "New-client proposal, done in 4 days, went through the full data + competitors + proposal + legal + approval flow"
  ~$0.001/run, 2-3 runs a day ≈ $0.003/day

Week level (weekly):
  Sonnet aggregates all cross-person tasks this week
  compares with org-playbook → finds deviations → updates or creates entries
  ~$0.03/week ≈ $0.004/day

Month level (monthly):
  Opus does a deep organisational analysis
  updates org/identity/ (is the team culture changing?)
  finds capability-gap trends (which roles are getting tighter?)
  ~$0.50/month ≈ $0.02/day

Organisational distillation total: ~$0.03/day/team (not per person)
```

### Data isolation

```
The raw content of personal Playbooks → always stays on the employee's machine
What the organisational Playbook sees → only role tags + confidence values + flow timing

org-playbook knows:
  ✅ "The data-analysis role usually takes 1 day"
  ✅ "Zhao Liu's data-analysis confidence is 0.95"
  ✅ "This legal review changed 3 places"

org-playbook does not know:
  ❌ What data Zhao Liu actually looked up
  ❌ Which three clauses Li Si changed
  ❌ What Wang Wu wrote in the proposal

Unless an employee explicitly authorises sharing Playbook content (e.g. a "best practice sharing" scenario)
```

(For product split and pricing, see protocol-architecture.md)
