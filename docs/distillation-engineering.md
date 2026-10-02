# Distillation Engine Engineering Design

For the theoretical design, see distillation-design.md. This document defines the engineering implementation: architecture overview, orchestration architecture, process model, technology choices, storage layer, data flow, external interfaces, crash recovery, and the path to the cloud.

---

## Architecture overview

```
  Capture adapters                                             Management center  Application layer
  (Screenpipe/IDE/...)                                         (Electron)     (Claude Code/Cursor/...)
        │                                                          │                │
        │ ① Observation Protocol                                   │                │
        │   (CloudEvents)                                          │                │
        ▼                                                          │                │
┌───────────────────────────────────────────────────────────────────┼────────────────┤
│  Distillation engine daemon (single process)                      │                │
│                                                                    │                │
│  ┌──────────────────────────────────────────────────────────────┐ │                │
│  │  EventBus (copied from Home Assistant)                        │ │                │
│  │  All inter-layer communication goes over the event bus,       │ │                │
│  │  with one unified TriggerProtocol                             │ │                │
│  └──────────────────────┬───────────────────────────────────────┘ │                │
│                          │                                         │                │
│  ┌──────────────────────┼───────────────────────────────────────┐ │                │
│  │  Distillation pipeline                                        │ │                │
│  │                                                               │ │                │
│  │  Second level (rules, $0) → micro_features                    │ │                │
│  │  Task level (Haiku) → episodes                                │ │                │
│  │  Hour level (statistics, $0) → rhythm_patterns                │ │                │
│  │  Day level (Sonnet agent loop) → daily_digests                │ │                │
│  │  Week level (Opus agent loop) → playbook/identity/meta        │ │                │
│  └───────────────────────────────────────────────────────────────┘ │                │
│                                                                    │                │
│  ┌──────────────────────────────────────────────────────────────┐ │                │
│  │  Execution layer (real-time, reactive)                        │ │                │
│  │  Situation matching → auto/suggest/observe                    │ │                │
│  └──────────────────────────────────────────────────────────────┘ │                │
│                                                                    │                │
│  ┌──────────────────────────────────────────────────────────────┐ │                │
│  │  Storage layer (all SQLite; PostgreSQL in the cloud)          │ │                │
│  │  13 tables, every table carries owner_id                      │ │                │
│  └──────────────────────┬───────────────────────────────────────┘ │                │
│                          │                                         │                │
│  ┌──────────────────────┴───────────────────────────────────────┐ │                │
│  │  Interface layer (the daemon's external boundary)             │ │                │
│  │                                                               │ │                │
│  │  ② Memory Protocol (JSON Schema + REST semantics)             │◄┼────────────────┤
│  │     /memory/playbook/, /memory/identity/, ...                 │ │                │
│  │                                                               │ │                │
│  │  ③ Query Protocol (REST + vector search)                      │◄┼────────────────┘
│  │     /memory/episodes/search, /memory/episodes/{date}, ...     │ │
│  │                                                               │ │
│  │  Management API                                               │◄┘
│  │     /engine/status, /engine/questions, /engine/execution/     │
│  │                                                               │ │
│  │  Transport: local = read SQLite directly / separate           │
│  │  deployment = HTTP / cloud = HTTP + auth                      │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                    │
│  LLM: LiteLLM Router (opus→sonnet→haiku fallback)                 │
│  Agent loop: Pydantic AI    Concurrency: asyncio.Semaphore(2)     │
│  Crash recovery: cursor + checkpoint + Target idempotency         │
└────────────────────────────────────────────────────────────────────┘
```

**Protocol mapping** (see protocol-architecture.md for details):

| Boundary | Protocol | Direction |
|------|------|------|
| Capture adapters → distillation engine | ① Observation Protocol (CloudEvents) | In |
| Distillation engine → application layer / management center | ② Memory Protocol (JSON Schema + REST semantics) | Out |
| Distillation engine → application layer / management center | ③ Query Protocol (REST + vector search) | Out |

**Transport strategy**: the protocols define semantics (GET/PUT/POST + JSON Schema); the transport is chosen by deployment mode:

| Deployment mode | Transport | Notes |
|----------|-----------|------|
| Local, same machine | Read SQLite directly (WAL) | The protocol says "the local implementation is just file operations" |
| Separate deployment | HTTP REST (FastAPI) | Maps directly onto the protocol's REST semantics |
| Cloud multi-tenant | HTTP REST + auth | PostgreSQL, over the network |

---

## Orchestration architecture: copied from Home Assistant

### Reference sources

| Source | What we copy | What we don't copy |
|------|--------|---------|
| **Home Assistant** (main reference) | EventBus + TriggerProtocol + RestoreEntity crash recovery | YAML DSL, the Integration plugin system, the Entity model |
| **Dagster** (supplementary reference) | DaemonController's thread-per-concern model | Materialize, IO Manager, the asset graph |
| **Luigi** (supplementary reference) | The Target idempotency pattern (mark only after the write completes; a retry after a crash does not duplicate) | Static DAGs, file-centric Targets |

### EventBus

All inter-layer communication goes over the event bus, not direct function calls. This copies Home Assistant's `EventBus` design:

```python
class EventBus:
    """Copied from HA's homeassistant/core.py EventBus"""

    def __init__(self):
        self._listeners: dict[str, list[Callable]] = {}

    def listen(self, event_type: str, callback: Callable) -> None:
        """Register a listener. Layers register when they start."""
        self._listeners.setdefault(event_type, []).append(callback)

    async def fire(self, event_type: str, data: dict) -> None:
        """Fire an event. All registered listeners run asynchronously."""
        for callback in self._listeners.get(event_type, []):
            asyncio.create_task(callback(data))
```

Event types:

| Event | Producer | Consumer |
|------|--------|--------|
| `screenpipe.raw_events` | Screenpipe poller | Second level (signal filtering) |
| `pipeline.micro_features` | Second level | Execution layer (situation matching) |
| `pipeline.task_boundary` | Second level (boundary detection) | Task level |
| `pipeline.episode_created` | Task level | (logging/monitoring) |
| `cron.rhythm` | CronTrigger 12:00/23:00 | Hour level |
| `cron.daily` | CronTrigger 23:00 | Day level |
| `cron.weekly` | CronTrigger Sunday 03:00 | Week level |
| `execution.result` | Execution layer | meta_ratings update |

### TriggerProtocol

Unifies three trigger styles (polling, events, schedules); all implement the same protocol:

```python
class TriggerProtocol(Protocol):
    """Copied from HA's homeassistant/helpers/trigger.py"""

    async def async_attach_trigger(self, config: dict, action: Callable) -> Callable:
        """Register a trigger; return a detach callback."""
        ...

class PollingTrigger:
    """Poll the Screenpipe SQLite every N seconds."""
    interval: float = 5.0

class EventTrigger:
    """Listen for a specific event on the EventBus."""
    event_type: str

class CronTrigger:
    """Scheduled trigger. A cron expression."""
    cron_expr: str
```

The second level uses PollingTrigger (polls Screenpipe every 5 seconds), the task level uses EventTrigger (listens for task_boundary), and the hour/day/week levels use CronTrigger.

### Why copy Home Assistant and not something else

- **Isomorphic problem**: HA is also a single-process daemon that manages many heterogeneous data sources (sensors = Screenpipe), triggers many automations (automation = each layer of the distillation pipeline), and needs crash recovery
- **Proven in production**: HA has a large user base, and the EventBus architecture has run for 10 years
- **Not an orchestration framework**: Dagster/Temporal/Prefect are orchestration frameworks designed for data pipelines/microservices; they are too heavy. We need in-application orchestration, not distributed orchestration
- **No good reference for a local AI daemon**: Screenpipe/Mem0/Khoj are all hand-rolled; none has an orchestration layer worth copying

---

## Process model

A single Python daemon process with a single asyncio event loop. No multiprocessing.

The tech stack is locked in by the engineering choices: Pydantic AI and LiteLLM are both Python, so there is no alternative.

```
standmeet-engine start
  │
  ├── 1. Initialize the EventBus
  │      Create the event bus; register the listeners of every layer
  │
  ├── 2. Initialize the storage layer
  │      ├── Connect state.db (SQLite, all distillation data)
  │      │   Every table carries owner_id; locally there is only one value
  │      │   For the cloud, switch to PostgreSQL + pgvector by changing the connection string
  │      ├── Initialize the sqlite-vec extension (vector index for episodes)
  │      └── Open Screenpipe's SQLite (read-only consumer)
  │
  ├── 3. Initialize Screenpipe (embedded dependency)
  │      import screenpipe, start capture inside the process
  │      Screenpipe writes its own SQLite; the distillation engine only reads it
  │
  ├── 4. Auto-discover local tools
  │      Detect ~/.gitconfig → register git_log
  │      Detect ~/.zsh_history → register shell_history
  │      Detect ~/Library/Safari/ → register browser_history
  │      ... scan the environment, register into tool_registry
  │
  ├── 5. Initialize LLM routing
  │      LiteLLMRouter(
  │        fallbacks={"opus": ["sonnet"], "sonnet": ["haiku"]},
  │        num_retries=3
  │      )
  │      asyncio.Semaphore(2)  ← at most 2 parallel LLM calls
  │
  ├── 6. Register Triggers
  │      PollingTrigger(5s)   → screenpipe.raw_events → second-level processing
  │      EventTrigger         → pipeline.task_boundary → task-level processing
  │      CronTrigger(12,23)   → cron.rhythm → hour-level processing
  │      CronTrigger(23)      → cron.daily → day-level processing
  │      CronTrigger(Sun 03)  → cron.weekly → week-level processing
  │
  └── 7. Start the Memory Protocol REST server
         FastAPI on localhost, exposed to the management center and the application layer
```

---

## Technology choices

| Component | Choice | Rationale |
|------|------|------|
| Orchestration architecture | EventBus + TriggerProtocol (copied from Home Assistant) | Decouples layers, one unified trigger protocol, orchestration inside a single process |
| Task persistence | Huey + SqliteHuey | Zero external dependencies, persistent task queue, crash recovery |
| LLM routing | LiteLLM Router | Fallback chain (opus→sonnet→haiku), automatic retry on 429/5xx, exponential backoff 0.5s→60s |
| Agent loop | Pydantic AI | Typed tool definitions, switch model dynamically at runtime, structured output |
| Concurrency control | asyncio.Semaphore(2) | At most 2 parallel LLM calls, to avoid rate limits |
| REST server | FastAPI | Memory Protocol + management API |
| Vector search | sqlite-vec (local) → pgvector (cloud) | Embedded in SQLite, no external dependencies |
| Capture layer | Screenpipe (embedded dependency) | Screen OCR + audio Whisper, open source, imported and used directly |

### Huey's role

Huey does not own orchestration logic; orchestration goes through the EventBus. Huey does only two things:
1. **Task persistence**: LLM calls (task/day/week level) are enqueued into SqliteHuey and recover automatically after a crash
2. **Background execution**: long-running agent loops run on Huey worker threads so they do not block the asyncio event loop

### Rejected options

| Rejected | Rationale |
|------|------|
| Temporal | Too heavy; needs its own cluster |
| Celery | Needs Redis/RabbitMQ, which a desktop app cannot install |
| Prefect | Oriented toward a cloud service |
| Dagster | A data pipeline framework, not in-application orchestration (but we borrow its DaemonController thread-per-concern model) |
| Multi-process architecture | Screenpipe showed a single runtime is enough; no need for complex IPC |

---

## Storage layer: all database

No file system. All data lives in SQLite (locally); the design targets PostgreSQL's capabilities, and for cloud multi-tenancy we change the connection string. Every table carries `owner_id`.

### Database files

| File | Purpose | Owner |
|------|------|--------|
| `state.db` | All distillation data (every table below) | Distillation engine |
| `distillation.db` | Huey task queue + results | SqliteHuey |
| Screenpipe's SQLite | Raw capture data | Screenpipe (read-only consumption) |

### SQLite/PostgreSQL compatibility strategy

SQLite locally, PostgreSQL in the cloud. 90% of the SQL syntax is shared; the differences to watch:

| Feature | SQLite | PostgreSQL | Strategy |
|------|--------|------------|------|
| Auto-increment primary key | `INTEGER PRIMARY KEY` (auto-increments) | `GENERATED ALWAYS AS IDENTITY` | We use TEXT UUID primary keys and do not depend on auto-increment |
| JSON | `TEXT` + `json_extract()` | `JSONB` + `->` / `->>` | Store as TEXT, handle queries in the Python layer, never query JSON in SQL |
| Vector | sqlite-vec `FLOAT[768]` | pgvector `vector(768)` | Must extract a storage interface; the APIs are completely different |
| Boolean | 0/1 (no real BOOLEAN) | true/false | Always write 0/1; PG converts automatically |
| Timestamp | TEXT (ISO8601) | `TIMESTAMP WITH TIME ZONE` | Always store ISO8601 TEXT |
| UPSERT | `INSERT ... ON CONFLICT DO UPDATE` | Same | Both support it (SQLite 3.24+) |

**Conclusion**: the schema is portable as is. The only truly incompatible part is the vector column (sqlite-vec vs pgvector); one VectorStore interface layer covers it. JSON fields are stored but never queried (queries happen in the Python layer), which avoids syntax differences.

### Schema

```sql
-- Playbook: playbook_files one-to-many playbook_entries
-- Before: "one md file stuffed with several situation-action pairs"
-- Now: structured rows

CREATE TABLE playbook_files (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  filename TEXT NOT NULL,         -- "debugging", a logical grouping
  description TEXT NOT NULL,      -- one-line description for the agent
  maturity TEXT NOT NULL DEFAULT 'nascent',  -- nascent/developing/mature/mastered
  entry_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL,
  UNIQUE(owner_id, filename)
);

CREATE TABLE playbook_entries (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  playbook_file_id TEXT NOT NULL REFERENCES playbook_files(id),
  situation TEXT NOT NULL,        -- situation description
  action TEXT NOT NULL,           -- action description
  why TEXT,                       -- inferred reason
  confidence REAL NOT NULL DEFAULT 0.5,
  evidence_ids JSON,              -- linked episode ids
  stress_variant BOOLEAN NOT NULL DEFAULT FALSE,
  is_counterexample BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);

CREATE TABLE identity (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  section TEXT NOT NULL,          -- "values" / "style" / "rhythm"
  content TEXT NOT NULL,
  updated_at TIMESTAMP NOT NULL,
  UNIQUE(owner_id, section)
);

CREATE TABLE episodes (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  date DATE NOT NULL,
  time_start TIMESTAMP NOT NULL,
  time_end TIMESTAMP NOT NULL,
  summary TEXT NOT NULL,
  tags JSON,
  stress_marked BOOLEAN NOT NULL DEFAULT FALSE,
  type TEXT NOT NULL DEFAULT 'observation',  -- "observation" / "user_explanation"
  absorbed BOOLEAN NOT NULL DEFAULT FALSE,
  embedding BLOB,                -- sqlite-vec vector; becomes the vector type in the cloud
  created_at TIMESTAMP NOT NULL
);

CREATE TABLE micro_features (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  timestamp TIMESTAMP NOT NULL,
  feature_type TEXT NOT NULL,    -- "correction"/"choice"/"sequence"/"pause"/"abandonment"/"avoidance"/"stress"
  description TEXT NOT NULL,
  signal_strength INTEGER NOT NULL,  -- 1-5
  stress_context BOOLEAN NOT NULL DEFAULT FALSE,
  raw_event_ids JSON,
  created_at TIMESTAMP NOT NULL
);

CREATE TABLE daily_digests (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  date DATE NOT NULL UNIQUE,
  content TEXT NOT NULL,
  key_episode_ids JSON,
  created_at TIMESTAMP NOT NULL
);

CREATE TABLE rhythm_patterns (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  date DATE NOT NULL,
  deep_work_windows JSON,
  context_switch_rate REAL,
  energy_curve JSON,
  app_time_distribution JSON,
  created_at TIMESTAMP NOT NULL
);

CREATE TABLE meta_ratings (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  playbook_filename TEXT NOT NULL,
  discovery_rate REAL,            -- d(t)
  prediction_accuracy REAL,       -- p
  modification_rate REAL,         -- m(t)
  boundary_completeness REAL,     -- b
  sample_size INTEGER NOT NULL DEFAULT 0,
  execution_mode TEXT NOT NULL DEFAULT 'observe',  -- "auto"/"suggest"/"observe"
  last_verified DATE,
  history JSON,                   -- weekly snapshots [{week, d, p, m, b}, ...]
  updated_at TIMESTAMP NOT NULL,
  UNIQUE(owner_id, playbook_filename)
);

CREATE TABLE meta_gaps (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  observed TEXT NOT NULL,
  gap TEXT NOT NULL,
  context_ref TEXT,
  asked BOOLEAN NOT NULL DEFAULT FALSE,
  answer_received BOOLEAN NOT NULL DEFAULT FALSE,
  priority REAL NOT NULL DEFAULT 0.5,
  created_at TIMESTAMP NOT NULL
);

CREATE TABLE meta_unanswered (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  question TEXT NOT NULL,
  context TEXT,
  created_at TIMESTAMP NOT NULL
);

CREATE TABLE meta_corrections (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  agent_draft TEXT NOT NULL,
  user_actual TEXT NOT NULL,
  diff TEXT,
  episode_id TEXT REFERENCES episodes(id),
  created_at TIMESTAMP NOT NULL
);

CREATE TABLE agent_checkpoints (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  agent_type TEXT NOT NULL,       -- "daily" / "weekly"
  run_date DATE NOT NULL,
  message_history JSON NOT NULL,
  updated_at TIMESTAMP NOT NULL,
  UNIQUE(owner_id, agent_type, run_date)
);
```

---

## Data flow: a layer-by-layer trace

### Data consumption: reading events from Screenpipe

Screenpipe runs inside the distillation engine process as an embedded dependency and writes captured data into its own SQLite. The distillation engine is a read-only consumer of that SQLite. Screenpipe's SQLite is in WAL mode, so reads do not block writes.

PollingTrigger polls every 5 seconds and dispatches through the EventBus:

```python
class ScreenpipePoller:
    """Driven by PollingTrigger, runs every 5 seconds."""

    async def poll(self):
        last_id = state_db.get_cursor('screenpipe_last_id')
        rows = screenpipe_db.query("SELECT * FROM ocr_text WHERE rowid > ?", [last_id])
        if not rows:
            return

        state_db.set_cursor('screenpipe_last_id', rows[-1].rowid)

        events = [to_cloud_event(row) for row in rows]  # convert to CloudEvents (Observation Protocol)
        await event_bus.fire('screenpipe.raw_events', {'events': events})
```

### Second level: signal filtering + micro-action extraction

Listens for the `screenpipe.raw_events` event. Synchronous, pure rules, zero LLM.

```python
class SecondLevelProcessor:
    """Listens for screenpipe.raw_events; produces micro_features and task_boundary."""

    def __init__(self, event_bus: EventBus):
        event_bus.listen('screenpipe.raw_events', self.handle)

    async def handle(self, data: dict):
        events = data['events']

        # Signal filtering: 5 detectors, filters out ~90% of noise
        filtered = signal_filter.process(events)

        # Micro-action extraction
        micro_features = micro_extractor.extract(filtered)
        state_db.bulk_insert('micro_features', micro_features)

        # Broadcast the micro-action event (the execution layer listens)
        await event_bus.fire('pipeline.micro_features', {'features': micro_features})

        # Detect task boundaries → trigger the task level
        for chunk in boundary_detector.detect(filtered):
            await event_bus.fire('pipeline.task_boundary', {'chunk': chunk})
```

- `SignalFilter.process(events)` — 5 detectors (correction, choice, pause, abandonment, stress) tag events; untagged events are dropped
- `MicroExtractor.extract(filtered)` — generates micro_features rows from tagged events
- `AvoidanceDetector.update(events)` — counts "available but not used" across events
- `BoundaryDetector.detect(filtered)` — detects task boundaries (a big context switch, a git commit, a long pause)

Writes: `INSERT INTO micro_features`. Always writes; if there are events, there is output.

### Task level: a single Haiku call

Listens for the `pipeline.task_boundary` event and enqueues the work into Huey:

```python
class TaskLevelProcessor:
    """Listens for pipeline.task_boundary; Haiku summarizes the sequence."""

    def __init__(self, event_bus: EventBus):
        event_bus.listen('pipeline.task_boundary', self.handle)

    async def handle(self, data: dict):
        chunk = data['chunk']
        # Enqueue into Huey; do not block the event loop
        distill_task_level(chunk)

@huey.task()
def distill_task_level(chunk: TaskChunk):
    features = state_db.query(
        "SELECT * FROM micro_features WHERE timestamp BETWEEN ? AND ?",
        [chunk.start, chunk.end]
    )

    prompt = build_task_prompt(features)

    async with llm_semaphore:
        response = await litellm_router.acompletion(model="haiku", messages=[...])

    summary = response.choices[0].message.content
    embedding = await get_embedding(summary)

    state_db.insert('episodes', {
        owner_id, date=chunk.date, time_start=chunk.start, time_end=chunk.end,
        summary=summary, tags=extract_tags(summary),
        stress_marked=any(f.stress_context for f in features),
        type="observation", absorbed=False,
        embedding=embedding,
    })

    event_bus.fire('pipeline.episode_created', {'episode_id': ...})
```

About 50 chunks a day, ~$0.05/day. Always writes: every chunk produces exactly one episode.

### Hour level: pure statistics

Triggered by CronTrigger at 12:00/23:00, via the `cron.rhythm` event:

```python
class RhythmProcessor:
    """Driven by CronTrigger; pure statistics, zero LLM."""

    def __init__(self, event_bus: EventBus):
        event_bus.listen('cron.rhythm', self.handle)

    async def handle(self, data: dict):
        events = screenpipe_db.query_today()

        state_db.insert('rhythm_patterns', {
            owner_id, date=today(),
            deep_work_windows=detect_deep_work(events),
            context_switch_rate=calc_switch_rate(events),
            energy_curve=calc_energy_curve(events),
            app_time_distribution=calc_app_usage(events),
        })
```

Zero LLM, always writes.

### Day level: Sonnet agent loop

Triggered by CronTrigger at 23:00. A Pydantic AI agent, multi-turn, typically 4-8 turns. Enqueued into Huey.

```python
day_agent = Agent(
    model=litellm_router,
    system_prompt=DAY_DISTILL_PROMPT,
    tools=[
        query_episodes,   # SELECT FROM episodes WHERE date = ?
        read_episode,      # SELECT FROM episodes WHERE id = ?
        query_stats,       # SELECT FROM rhythm_patterns WHERE date = ?
        read_playbook,     # SELECT FROM playbook_files JOIN playbook_entries
        query_history,     # SELECT FROM episodes WHERE ... AND date BETWEEN
        write_day_report,  # INSERT INTO daily_digests
        write_insight,     # INSERT INTO episodes (type='observation')
    ],
)

@huey.task()
def distill_daily():
    # Inject the Playbook index into the system prompt
    playbook_index = state_db.query(
        "SELECT filename, description, maturity, entry_count FROM playbook_files"
    )

    result = day_agent.run_sync(
        f"Analyze the behavior data for {today()}",
        model="sonnet",
        message_history=restore_checkpoint("daily", today()),
    )
```

Always writes the daily report (daily_digests); the number of insights varies. It suggests Playbook changes but does not write the Playbook directly; that is left for the week level to confirm.

After each tool_use completes, a checkpoint is saved automatically to the agent_checkpoints table.

### Week level: Opus agent loop

Triggered by CronTrigger on Sunday at 03:00. The largest tool set, typically 8-15 turns. Enqueued into Huey.

```python
week_agent = Agent(
    model=litellm_router,
    system_prompt=WEEK_DISTILL_PROMPT,
    tools=[
        # Read
        read_day_report,     # SELECT FROM daily_digests
        drill_down,           # episode → micro_features, drilling down layer by layer
        find_similar,         # SELECT FROM episodes ORDER BY embedding <-> $vec
        read_playbook,        # SELECT FROM playbook_files JOIN entries
        read_meta,            # SELECT FROM meta_ratings / meta_gaps

        # Write the Playbook (the agent decides on its own whether to write)
        update_playbook,      # UPDATE playbook_entries / INSERT
        create_playbook,      # INSERT INTO playbook_files + entries

        # Write Identity (rarer)
        update_identity,      # UPDATE identity SET content = ?

        # Write Meta
        update_confidence,    # UPDATE meta_ratings
        update_rating,        # compute d(t)/p/m(t)/b, UPDATE meta_ratings
        mark_episode_absorbed,# UPDATE episodes SET absorbed = true

        # Local tools (auto-discovered, vary per person)
        *tool_registry.get_all(),
    ],
)

@huey.task()
def distill_weekly():
    result = week_agent.run_sync(
        f"Analyze the behavior data for {this_week_range()}",
        model="opus",
        message_history=restore_checkpoint("weekly", this_week()),
    )
```

---

## Write modes

The key distinction: deterministic pipeline writes vs autonomous agent writes.

### Deterministic writes (incoming data always produces output)

| Layer | Table written | Trigger | Frequency |
|---|--------|---------|------|
| Second level | micro_features | PollingTrigger every 5 seconds | Writes whenever there are events |
| Task level | episodes | EventTrigger task_boundary | Every chunk produces output |
| Hour level | rhythm_patterns | CronTrigger 12:00/23:00 | 2 times a day |
| Day level | daily_digests | CronTrigger 23:00 | Once a day |
| Execution layer | meta_ratings (prediction_accuracy) | After each execution | Real time |

### Autonomous writes (the agent decides whether to write)

| Layer | Table written | Condition |
|---|--------|------|
| Day level | episodes (insight) | Writes only when Sonnet finds something worth recording; the count varies |
| Week level | playbook_files + entries | Creates only when Opus sees a new pattern (≥3 similar situations); updates an existing entry only when it needs correcting |
| Week level | identity | Updates only when it finds a cross-domain commonality; very rare |
| Week level | meta_ratings (d/m/b) | Always writes rating updates |
| Week level | episodes (absorbed) | Marks only the ones absorbed into the Playbook |

---

## Execution layer

Real-time and reactive, completely different from the scheduled batch processing of the distillation pipeline. Listens for the `pipeline.micro_features` event.

```
pipeline.micro_features event arrives
  → Haiku does situation matching
    → SELECT FROM playbook_entries WHERE situation LIKE ...
    → SELECT execution_mode FROM meta_ratings WHERE playbook_filename = ...
  → Route by execution_mode:
      "auto"    → agent executes directly → notifies the user when done
      "suggest" → drafts a plan → pushes it to the management center → executes only after the user confirms
      "observe" → does nothing, only records

After execution, fire execution.result through the EventBus:
  accept → UPDATE meta_ratings SET prediction_accuracy += ...
  modify → INSERT INTO meta_corrections + UPDATE meta_ratings
  reject → UPDATE meta_ratings SET prediction_accuracy -= ...
           3 consecutive rejects → execution_mode is downgraded

Downgrades are real time (one reject immediately moves auto→suggest)
Upgrades wait for the week level (all 5 conditions met for 2 consecutive weeks)
```

---

## External interfaces

For the protocol definitions, see protocol-architecture.md. The distillation engine implements three of them:

| Direction | Protocol | Distillation engine's role |
|------|------|--------------|
| In | ① Observation Protocol (CloudEvents) | Consumer: receives raw events from capture adapters |
| Out | ② Memory Protocol (JSON Schema + REST semantics) | Provider: exposes memory data to the management center and the application layer |
| Out | ③ Query Protocol (REST + vector search) | Provider: exposes the query interface to the management center and the application layer |

### The distillation engine's own management API

Not part of the protocols; this is the distillation engine's internal management interface:

```
GET  /engine/status                      → capture status, pipeline progress, memory statistics
GET  /engine/questions                   → meta_gaps WHERE asked=false ORDER BY priority
POST /engine/questions/{id}/answer       → INSERT episodes(type='user_explanation') + UPDATE meta_gaps
POST /engine/execution/{id}/approve      → execution approval
GET  /engine/execution/history           → execution history
```

### SQLite concurrency safety

The distillation engine is the only writer of state.db. External consumers (management center, MCP server), when deployed on the same machine, can open state.db read-only directly (the protocol says "the local implementation is just file operations").

Lessons from SkyPilot's pitfalls:
- WAL mode must be on (`PRAGMA journal_mode=WAL`)
- Set `busy_timeout` to 60 seconds (not the default 5 seconds)
- The distillation engine is the only writer and consumers only read, so there are no write-write conflicts

---

## Crash recovery

Four layers of protection, borrowing Luigi's Target idempotency pattern (mark complete only after the write finishes; a retry after a crash does not duplicate):

1. **Screenpipe cursor** — one cursor value in state.db (the last rowid); a restart continues from the last position, with no loss and no duplication
2. **Huey task persistence** — distillation.db (SqliteHuey); unfinished tasks are restored to the queue automatically on restart
3. **Agent checkpoint** — the agent_checkpoints table stores message_history after each tool_use; after a crash, the agent continues from the last checkpoint instead of rerunning the whole agent loop
4. **Target idempotency** — every write first checks whether the target already exists (for example, the UNIQUE(date) on daily_digests); if it exists, the write is skipped, so nothing is written twice

---

## Path to the cloud

| Local | Cloud |
|------|------|
| SQLite state.db | PostgreSQL |
| sqlite-vec | pgvector |
| SqliteHuey distillation.db | RedisHuey or Celery |
| Single-process daemon | K8s pod |
| owner_id fixed to one value | Multi-tenant |
| localhost REST | Public REST + auth |

The schema does not change; every table already has owner_id. The vector column is isolated behind the VectorStore interface, and the rest of the SQL syntax is 100% compatible.

---

## Cost

```
Second level:     $0 (pure rules)
Task level:       $0.05/day (Haiku, ~50 calls)
Hour level:       $0 (statistics)
Day level:        $0.03/day (Sonnet, 4-8 turns)
Week level:       $0.15-0.40/day amortized (Opus, 8-15 turns)
Execution layer:  $0.07/day (Haiku matching + Sonnet drafts)
─────────────────
Total:            ~$0.30-0.55/day ≈ $10-17/month/user
```
