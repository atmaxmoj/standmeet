# Protocol specifications

Four protocols define the communication boundaries between products. All protocols are open source (MIT); implementations are licensed flexibly.

See product-vision.md for the product architecture and product definition. See licensing.md for the license strategy.

---

## Product architecture diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                  │
│  ┌────────────────┐  ① Observation Protocol (CloudEvents)        │
│  │ Capture        │─────────────────────────────────────────┐    │
│  │ adapters       │  Any protocol-compliant capturer        │    │
│  │ Screenpipe     │  can plug in                            │    │
│  │ IDE plugins    │                                         │    │
│  │ Mobile sensors │                                         │    │
│  │ Custom adapters│                                         │    │
│  └────────────────┘                                         │    │
│                                                             ▼    │
│  ┌──────────────────────────────────────────────────────────┐     │
│  │  Distillation engine                                      │     │
│  │  Signal filtering + multi-layer pipeline                  │     │
│  │  (second/task/hour/day/week)                              │     │
│  │  Playbook rating updates                                  │     │
│  └──────────────────────────┬───────────────────────────────┘     │
│                              │                                    │
│                    ② Memory Protocol (JSON Schema + REST semantics)│
│                              │                                    │
│                              ▼                                    │
│  ┌──────────────────────────────────────────────────────────┐     │
│  │  Memory store                                             │     │
│  │  Playbook / Identity / Episodes / Meta                    │     │
│  │  Any schema-compliant storage backend                     │     │
│  │  (SQLite / PostgreSQL / ...)                              │     │
│  └──────────────────────────┬───────────────────────────────┘     │
│                              │                                    │
│                    ③ Query Protocol (REST + vector search)        │
│                              │                                    │
│                              ▼                                    │
│  ┌──────────────────────────────────────────────────────────┐     │
│  │  Execution engine                                         │     │
│  │  Situation detection + Playbook matching + Agent Loop     │     │
│  │  + MCP tools                                              │     │
│  └──────────────────────────┬───────────────────────────────┘     │
│                              │                                    │
│  Personal stack (all open    │                                    │
│  source, MIT)                │                                    │
│ ─────────────────────────────┼──────────────────────────────────  │
│  Organization stack          │                                    │
│  (commercial)                │                                    │
│                              │                                    │
│                    ④ Organization Protocol (inspired by A2A)      │
│                              │                                    │
│                              ▼                                    │
│  ┌──────────────────────────────────────────────────────────┐     │
│  │  Organization layer                                       │     │
│  │  Capability map aggregation + cross-person task           │     │
│  │  scheduling + organization distillation                   │     │
│  └──────────────────────────────────────────────────────────┘     │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## ① Observation Protocol — based on CloudEvents

### Why CloudEvents

- A CNCF standard, specifically for defining event data formats
- SDK coverage: Go, Java, JS/TS, Python, C#, Rust, Ruby
- Ecosystem: native support in Kafka, NATS, RabbitMQ, Knative
- Simple spec: JSON envelope + a few required fields, learnable in 5 minutes
- In local scenarios it is used as a JSON schema; no event broker needs to run
- When remote scenarios come later (phone → desktop), transport bindings are ready-made

### Value for community contributors

**To write a new capture adapter, you only need to output the CloudEvents format to plug in; you don't need to read the internal code.**

### Event format

All observation events share the CloudEvents envelope; the `type` field distinguishes event categories:

```json
{
  "specversion": "1.0",
  "id": "evt-20260313-103200-a1b2c3",
  "type": "standmeet.observation.correction",
  "source": "/adapter/screenpipe/vscode",
  "subject": "user/wangsijie",
  "time": "2026-03-13T10:32:00Z",
  "datacontenttype": "application/json",
  "data": {
    ...
  }
}
```

### Event type definitions

#### Signal events (output of the signal filtering layer)

```
standmeet.signal.correction        Correction (wrote → deleted → rewrote)
standmeet.signal.selection          Selection (several options → picked one)
standmeet.signal.sequence           Sequence (the order of steps in doing things)
standmeet.signal.pause              Pause (long inactivity → sudden big action)
standmeet.signal.abandonment        Abandonment (started → gave up midway → changed direction)
standmeet.signal.avoidance          Avoidance (available but not used)
standmeet.signal.pressure           Pressure (sudden frequency change, skipping routine steps)
standmeet.signal.task_boundary      Task boundary (big context switch, commit)
```

#### Common fields of signal event data

```json
{
  "signal_type": "correction",
  "app": "VS Code",
  "window_title": "server.ts - standmeet",
  "context": {
    "task_id": "task-20260313-1032",
    "pressure": false,
    "duration_ms": 3200
  },
  "detail": {
    ...  // each signal_type has its own detail schema
  }
}
```

#### correction detail

```json
{
  "before": "data",
  "after": "userProfile",
  "correction_type": "variable_rename",
  "ai_assisted": true,
  "ai_suggestion_accepted": false
}
```

#### selection detail

```json
{
  "options_seen": ["PostgreSQL", "MongoDB", "DynamoDB"],
  "selected": "PostgreSQL",
  "selection_method": "search_then_click",
  "time_to_decide_ms": 45000
}
```

#### avoidance detail

```json
{
  "tool": "Docker",
  "available_since": "2026-01-15",
  "last_used": null,
  "alternative_used": "native environment",
  "observation_count": 12
}
```

#### pressure detail

```json
{
  "indicators": ["save_frequency_2x", "app_switch_rate_3x", "skipped_tests"],
  "baseline_period": "2026-W09..W11",
  "deviation_factor": 2.3
}
```

#### Raw observation events (output of capture adapters, input of the signal filtering layer)

```
standmeet.raw.screen_text           Screen text change
standmeet.raw.audio_transcript      Audio transcription
standmeet.raw.app_switch             App switch
standmeet.raw.keystroke_stats        Keystroke statistics (no content, only rate/edit-delete rate)
standmeet.raw.file_change            File modification
standmeet.raw.clipboard              Clipboard change
```

Raw events are high-volume and noisy. The signal filtering layer consumes raw events and produces signal events. The distillation engine consumes only signal events.

### Adapter registration

Every capture adapter sends a registration event at startup:

```json
{
  "specversion": "1.0",
  "type": "standmeet.adapter.register",
  "source": "/adapter/screenpipe",
  "data": {
    "adapter_name": "screenpipe",
    "version": "0.24.0",
    "capabilities": ["screen_text", "audio_transcript", "app_switch"],
    "platform": "darwin",
    "sampling_mode": "event_driven"
  }
}
```

From this, the distillation engine knows which capture sources are currently online.

---

## ② Memory Protocol — JSON Schema + REST semantics

### Design principles

- Use JSON Schema to strictly define the structure of each kind of memory
- Use REST semantics to describe operations (GET/PUT/POST/DELETE/PATCH)
- **A local implementation is just file operations**; no HTTP server needs to run
- The schema is the core of the protocol — any storage backend that conforms to the schema is compatible

### Resource paths

```
/memory/
├── playbook/{filename}              GET / PUT / DELETE
├── identity/{filename}              GET / PUT
├── episodes/{date}                  GET / POST (append)
├── episodes/search                  POST (vector search)
├── meta/rating                      GET / PATCH
├── meta/confidence                  GET / PATCH
├── meta/gaps                        GET / POST
├── meta/corrections                 GET / POST
├── meta/unanswered                  GET / POST
└── meta/staleness                   GET / PATCH
```

### Playbook Entry Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "standmeet://memory/playbook-entry",
  "type": "object",
  "required": ["situation", "reaction", "confidence"],
  "properties": {
    "situation": {
      "type": "string",
      "description": "Description of the situation"
    },
    "reaction": {
      "type": "string",
      "description": "Observed behavioral reaction"
    },
    "why": {
      "type": "string",
      "description": "Reason inferred from the behavior"
    },
    "confidence": {
      "type": "number",
      "minimum": 0,
      "maximum": 1
    },
    "evidence": {
      "type": "array",
      "items": {
        "type": "string",
        "description": "Source episode ID"
      }
    },
    "pressure_variant": {
      "type": "boolean",
      "description": "Whether this is a pressure variant"
    },
    "counterexample": {
      "type": "boolean",
      "description": "Whether this is a counterexample"
    },
    "first_observed": {
      "type": "string",
      "format": "date"
    },
    "last_observed": {
      "type": "string",
      "format": "date"
    }
  }
}
```

### Playbook File Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "standmeet://memory/playbook-file",
  "type": "object",
  "required": ["name", "description", "entries"],
  "properties": {
    "name": { "type": "string" },
    "description": { "type": "string" },
    "last_updated": { "type": "string", "format": "date" },
    "entries": {
      "type": "array",
      "items": { "$ref": "standmeet://memory/playbook-entry" }
    },
    "underlying_values": {
      "type": "array",
      "items": { "type": "string" },
      "description": "Commonalities generalized across situations"
    }
  }
}
```

### Episode Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "standmeet://memory/episode",
  "type": "object",
  "required": ["id", "type", "timestamp", "content"],
  "properties": {
    "id": {
      "type": "string",
      "pattern": "^ep-[0-9]{8}-[a-z0-9]+$"
    },
    "type": {
      "type": "string",
      "enum": ["observation", "user_explanation", "agent_draft", "execution_feedback"]
    },
    "timestamp": {
      "type": "string",
      "format": "date-time"
    },
    "content": {
      "type": "string",
      "description": "Summary text"
    },
    "source_signals": {
      "type": "array",
      "items": { "type": "string" },
      "description": "List of source CloudEvents IDs"
    },
    "context": {
      "type": "object",
      "properties": {
        "app": { "type": "string" },
        "task_id": { "type": "string" },
        "pressure": { "type": "boolean" },
        "duration_ms": { "type": "integer" }
      }
    },
    "embedding": {
      "type": "array",
      "items": { "type": "number" },
      "description": "Vector embedding (optional, generated by the storage backend)"
    },
    "absorbed_by": {
      "type": "string",
      "description": "Which Playbook file absorbed it (filled in after consolidation)"
    }
  }
}
```

### Rating Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "standmeet://memory/rating",
  "type": "object",
  "required": ["discovery_rate", "prediction_accuracy", "modification_rate", "boundary_completeness", "sample_size", "execution_mode"],
  "properties": {
    "discovery_rate": {
      "type": "number",
      "minimum": 0,
      "maximum": 1,
      "description": "d(t): share of new situation variants this week; corresponds to bisimulation failure type I"
    },
    "prediction_accuracy": {
      "type": ["number", "null"],
      "minimum": 0,
      "maximum": 1,
      "description": "p: execution acceptance rate (exponentially decay-weighted); corresponds to failure type β"
    },
    "modification_rate": {
      "type": "number",
      "minimum": 0,
      "description": "m(t): normalized number of times the Playbook was modified by distillation this week; corresponds to failure type α"
    },
    "boundary_completeness": {
      "type": "number",
      "enum": [0, 0.5, 1.0],
      "description": "b: has a counterexample (+0.5) + has a pressure variant (+0.5); corresponds to failure type F"
    },
    "sample_size": {
      "type": "integer",
      "minimum": 0
    },
    "execution_mode": {
      "type": "string",
      "enum": ["auto", "suggest", "observe"]
    },
    "last_verified": {
      "type": "string",
      "format": "date"
    },
    "history": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "week": { "type": "string" },
          "d": { "type": "number" },
          "p": { "type": ["number", "null"] },
          "m": { "type": "number" },
          "b": { "type": "number" }
        }
      }
    }
  }
}
```

---

## ③ Query Protocol — REST + vector search

The interface the distillation engine and the execution engine use to query the memory store.

### Structured queries

```
GET /memory/episodes/2026-03-13
GET /memory/episodes/2026-03-13?signal_type=correction&pressure=true
GET /memory/playbook/debugging.md
GET /memory/meta/rating
GET /memory/meta/rating?execution_mode=auto
GET /memory/meta/gaps?asked=false&priority_gte=0.8
```

### Vector search

```
POST /memory/episodes/search
{
  "query": "chose the more constrained option",
  "time_range": {
    "from": "2026-01-01",
    "to": "2026-03-13"
  },
  "limit": 10,
  "min_similarity": 0.7
}

Response:
{
  "results": [
    {
      "id": "ep-20260305-a1b2c3",
      "content": "Tech choice: picked TypeScript over JavaScript",
      "similarity": 0.92,
      "timestamp": "2026-03-05T14:30:00Z"
    },
    ...
  ]
}
```

### Aggregate queries

```
POST /memory/episodes/aggregate
{
  "group_by": "signal_type",
  "time_range": { "from": "2026-W11", "to": "2026-W11" },
  "metrics": ["count", "avg_pressure"]
}
```

### Local tool queries (pass-through)

Local tools do not go through the Memory Protocol — the distillation engine and execution engine call local tools (git_log, shell_history, etc.) directly. These tools are the agent's tool_use, not part of the memory store.

---

## ④ Organization Protocol — inspired by A2A

### Background

What Google's A2A (Agent-to-Agent) protocol does: an agent broadcasts its capabilities (Agent Card), receives tasks, and returns results. The needs of the StandMeet organization layer closely match A2A.

### Agent Card (exported automatically from the Playbook Rating)

Each user's agent periodically publishes its capability card:

```json
{
  "agent_id": "agent/wangsijie",
  "updated_at": "2026-03-13T00:00:00Z",
  "capabilities": [
    {
      "skill": "debugging",
      "execution_mode": "auto",
      "prediction_accuracy": 0.91,
      "sample_size": 47
    },
    {
      "skill": "tech-selection",
      "execution_mode": "suggest",
      "prediction_accuracy": 0.78,
      "sample_size": 15
    },
    {
      "skill": "code-review",
      "execution_mode": "auto",
      "prediction_accuracy": 0.88,
      "sample_size": 32
    }
  ]
}
```

Note: the Agent Card **exposes only capability labels and rating values**, not Playbook content. Data isolation is guaranteed at the protocol layer.

### Task object

The organization layer dispatches a task to personal agents:

```json
{
  "task_id": "org-task-20260313-001",
  "type": "standmeet.org.task",
  "title": "Partnership proposal for client ABC",
  "initiated_by": "agent/zhangsan",
  "deadline": "2026-03-17",
  "steps": [
    {
      "role": "data-analysis",
      "assigned_to": "agent/zhaoliu",
      "depends_on": [],
      "status": "pending"
    },
    {
      "role": "proposal-writing",
      "assigned_to": "agent/wangwu",
      "depends_on": ["data-analysis"],
      "status": "pending"
    }
  ]
}
```

### Flow Record (the input to organization distillation)

When a task is done, a flow record is generated automatically:

```json
{
  "type": "standmeet.org.flow_record",
  "task_id": "org-task-20260313-001",
  "completed_at": "2026-03-16T18:00:00Z",
  "steps": [
    {
      "role": "data-analysis",
      "assignee": "agent/zhaoliu",
      "started": "2026-03-13T09:15:00Z",
      "completed": "2026-03-13T11:30:00Z",
      "mode": "auto",
      "output_ref": "file://proposal/client-data-report.xlsx"
    },
    {
      "role": "proposal-writing",
      "assignee": "agent/wangwu",
      "started": "2026-03-14T14:00:00Z",
      "completed": "2026-03-14T16:30:00Z",
      "mode": "assisted",
      "corrections": 2,
      "output_ref": "file://proposal/proposal-v1.docx"
    }
  ],
  "total_duration_hours": 7.25,
  "outcome": "sent_to_client"
}
```

A Flow Record **records only role, time, mode, and number of corrections**, not the actual content. Organization distillation discovers collaboration patterns from this metadata and does not need to see what each person actually did.

---

## Protocol versioning

```
Each protocol has its own version number:
  Observation Protocol v1.0
  Memory Protocol v1.0
  Query Protocol v1.0
  Organization Protocol v1.0

Backward-compatibility policy:
  - Added fields: optional; old implementations ignore them
  - Removed fields: mark deprecated first, remove in the next major version
  - Breaking changes: major version +1

Schema publishing:
  All JSON Schemas are published at public URLs
  e.g. https://schema.standmeet.dev/v1/playbook-entry.json
  Implementers can reference them directly for validation
```
