# Product Vision

## Design goal

Split StandMeet from one monolithic system into **independent components that interact through protocols**. Each component can be replaced independently, and can be open-sourced or kept closed independently.

Core principle: **all protocols are open source; implementations are licensed flexibly.**

---

## Engineering philosophy (distilled from reference projects)

Core references: Elastic Stack (platform + Solutions on top), Grafana Labs (plugin architecture + big tent + wait for the right abstraction before unifying), HashiCorp (each product self-contained + integrated over network protocols).

### 1. The platform is the center of gravity; applications grow around it

Elasticsearch is the only indispensable product in the Elastic Stack. Beats, Logstash and Kibana are all optional, but they all read from and write to Elasticsearch. Elasticsearch is usable on its own (query it directly over the REST API), more usable with Kibana, and easier to feed with Beats.

**For StandMeet: the distillation engine (including memory storage) is the platform. Every application is optional, but they all read and write memory on the platform. The platform is usable on its own (query Playbooks via CLI / API), more usable with the management center, and more valuable in real scenarios with applications.**

### 2. Each product is self-contained; integration is added value

HashiCorp's Terraform, Vault and Consul are each independent — their own CLI, their own API, their own storage. You can use only Vault and never touch Terraform. They integrate over HTTP APIs, and the integration works exactly like a third-party integration (Terraform's Vault Provider goes through Vault's public API; there is no back door).

**For StandMeet: the digital-avatar showcase runs without the distillation engine (content is filled in by hand). The distillation engine runs without any application (it only observes and learns). When both exist, they talk through the Memory Protocol — the digital-avatar showcase reads distilled Playbooks, and conversation records flow back to the distillation engine as Episodes. But this is added value, not a precondition.**

### 3. Our own products also use the public interface — no back doors

When Grafana built Loki/Mimir/Tempo, they plugged into Grafana through exactly the same data source plugin interface as third parties, with no special treatment. This guarantees: (a) Grafana has no hidden dependency on its own backends, (b) third-party backends compete on equal terms with first-party ones.

**For StandMeet: the digital-avatar showcase reads the distillation engine's memory through exactly the same interface (Memory Protocol) as it reads hand-written content from its own local storage. No back door for the distillation engine.**

### 4. What is shared is a convention (schema), not infrastructure

Grafana uses its label system to correlate metrics/logs/traces. Elastic uses ECS (Elastic Common Schema) to unify field names. HashiCorp uses HCL to unify configuration syntax. What they share is always a **data format convention**, not a shared database or shared code.

**For StandMeet: the shared convention between products is the Memory Protocol's JSON Schema — the format definitions for Playbook, Episode, Identity and Meta. Any product that reads and writes schema-conformant data can interoperate.**

### 5. The ingestion layer is the most open; the platform layer stays controlled

Elastic's Beats (ingestion) is Apache 2.0; Elasticsearch (storage) is AGPL. Grafana's Alloy (ingestion) is Apache 2.0; Mimir/Loki/Tempo (storage) are AGPL. The logic: let as much data flow in as possible (open ingestion), and monetize at the storage and analysis layer.

**For StandMeet: ingestion adapters and protocol specs are the most open (AGPL / MIT), so the community can contribute all kinds of ingestion sources. The distillation engine is open source but protected by AGPL. The management center is commercial.**

### 6. Get products running independently first, then distill protocols from practice

Grafana ran separate agents for years (Prometheus agent, Promtail) and only shipped Alloy for unified ingestion in 2024 — it waited for the OpenTelemetry standard to stabilize first. Unifying too early means picking the wrong abstraction.

**For StandMeet: the four protocols defined in protocols.md are a direction, but there is no rush to freeze them. Get each product running first, validate the protocol design against real data flows, then stabilize gradually.**

### 7. The management center must exist because of complexity

Multiple self-contained products = multiple independent management UIs = management burden for the user. Docker Desktop exists because nobody wants to open ten terminals to manage containers. Kibana exists because nobody wants to query Elasticsearch with curl.

**For StandMeet: the distillation engine is a headless daemon, and each application is independent. The management center (Electron) pulls them into one interface — managing distillation engine state, managing app installation and configuration, answering proactive questions, approving execution suggestions. The more products there are, the more valuable the management center becomes.**

---

## Four-layer structure

The distillation engine is not a product; it is **infrastructure**. Nobody uses a database directly as a product, but every product needs a database. The distillation engine is the same — it produces Playbook/Episodes/Identity/Meta, and the application layer takes what it needs through protocols.

```
┌─────────────────────────────────────────────────┐
│  Application layer (products, each independent)   │
│                                                   │
│  Personal assistant  Journal generator  Digital-avatar showcase │
│  Emotional companion  Worker monitor (enterprise)  Knowledge transfer │
│  ...endless possibilities                         │
└──────────────────────┬──────────────────────────┘
                       │ Memory Protocol + Query Protocol
                       │
┌──────────────────────┴──────────────────────────┐
│  Electron client (management center)              │
│  Manages engine + apps + permissions + user entry │
└──────────────────────┬──────────────────────────┘
                       │
┌──────────────────────┴──────────────────────────┐
│  Distillation engine                              │
│  Ingest → filter → distill → memory storage       │
│  Pure background daemon, headless                 │
└──────────────────────┬──────────────────────────┘
                       │ Observation Protocol (CloudEvents)
                       │
┌──────────────────────┴──────────────────────────┐
│  Ingestion adapters                               │
│  Screenpipe / IDE plugins / mobile / custom       │
└─────────────────────────────────────────────────┘
```

---

## Product definitions

### Product 1: Distillation engine (platform)

**Standalone value**: observe user behavior → filter signals → multi-layer distillation → produce memory (Playbook/Identity/Episodes/Meta) → an execution layer acts on the user's behalf. It runs without any application. A user can use only the distillation engine for personal retrospectives, to view their own Playbooks, and to let an agent handle routine operations for them.

**Contains**:
- Ingestion layer (Screenpipe adapter + automatic discovery of local tools)
- Signal filtering layer (turning points / avoidance / stress / task boundaries)
- Multi-layer distillation pipeline (second-level rules → task-level Haiku → hour-level statistics → day-level Sonnet → week-level Opus)
- Memory storage (Playbook / Identity / Episodes / Meta, SQLite + vector index)
- Execution layer (situation detection → Playbook matching → agent execution → feedback loop)
- Active learning loop (ask a question → user answers → memory update)

**External interfaces**:
- Observation Protocol (CloudEvents) — input events from ingestion adapters
- Memory Protocol (JSON Schema + REST semantics) — the standard interface for the application layer to read and write memory
- Query Protocol (REST + vector search) — the application layer queries memory

**Tech stack**: Python daemon (see distillation-engineering.md)

**License**: AGPL v3

### Product 2: Management center (gateway + unified management surface)

**Why it exists**: every application being self-contained means every application has its own management UI. The distillation engine also needs management. If a user installs the distillation engine + 3 applications, they have to open 4 different management UIs. The management center gathers these in one place.

**It is essentially a gateway**: the management center knows which products are installed (distillation engine + each application), knows how to talk to each one, and aggregates each product's management surface into one unified interface.

**Contains**:

Distillation engine management surface (built in):
- Distillation engine status monitoring (ingestion status, distillation pipeline progress, memory statistics)
- Playbook browsing and editing (view situation-action pairs, maturity, ratings)
- Proactive question UI (the system's questions are pushed to the user; the user's answers are written back to memory)
- Execution approval (confirming operations in suggestion mode)
- Execution rule configuration (which operations may run fully automatically)
- Ingestion adapter management (on/off, permissions)

Application management surface (aggregated):
- App install / uninstall
- Load each app's management UI (each app provides its own management pages; the management center renders them as a shell)
- Unified entry point for app configuration

**Key design: user surface vs management surface**

Each application has two surfaces:

```
User surface (independent)        Management surface (aggregatable)
─────────────────────────────────────────────────
Digital-avatar showcase:          Digital-avatar showcase:
  visitor opens the web page        owner manages content, invite codes, roles
  enters an invite code             → running standalone: its own Electron
  chats with the AI                 → plugged into the management center: embedded in it
  this always stays independent

Journal generator:                Journal generator:
  user reads the journal            configure journal format, choose Episode sources
  this always stays independent     → running standalone: its own Web UI
                                    → plugged into the management center: embedded in it

Personal assistant:               Personal assistant:
  user talks to the assistant       configure execution permissions, view execution history
  this always stays independent     → running standalone: its own UI
                                    → plugged into the management center: embedded in it
```

**The user surface always belongs to the application itself; the management center never touches it. The management center only aggregates management surfaces.**

Applications use the **app registration protocol** to tell the management center: "who I am, which management pages I provide, where my management API is". The management center renders navigation and routes requests based on this.

**Relationship to the distillation engine**: the management center communicates through the Memory Protocol + the distillation engine's management API. The management center is a client of the distillation engine, not part of it. The distillation engine runs without the management center (managed via CLI / API).

**Tech stack**: Electron + React (reuses the tech stack of the existing standmeet-client)

**License**: Commercial

### Product 3+: Application layer (each independent)

Each application is an independent product, self-contained, with its own complete feature set. Plugging into the distillation engine enhances the experience, but the app does not depend on it.

**First application: digital-avatar showcase** (evolved from the existing StandMeet code)

Standalone value: the Owner fills in content by hand → a Visitor learns about the Owner by chatting with an AI. Two modes: Invitation Mode (WebSocket) and BYOAI Mode (MCP OAuth). No distillation engine needed.

Enhancements after plugging into the distillation engine:
- When answering, the AI relies not only on hand-written content but can also query Playbooks ("how does he usually debug this kind of bug")
- The AI can use Identity to reason about unseen scenarios ("when choosing technology he leans toward strongly constrained options")
- Conversation records flow back to the distillation engine as Episodes (what visitors asked, what the AI could not answer → distillation priority signals)
- Hand-written content and distilled memory share a compatible format and are read uniformly through the Memory Protocol

Contains:
- Content management (hand-written, the existing ContentEntry system)
- Roles and permissions (Role + PathPermission)
- Invite code system (InviteCode + Invitation Mode)
- MCP server (BYOAI Mode)
- Gateway (Claude Agent SDK + WebSocket)
- Web frontend (Next.js visitor UI)
- Admin client (Electron, manages content / invite codes / roles)

Tech stack: existing (Django + Node.js + Next.js + Electron)

**Future applications (each an independent product)**:

| Application | Standalone value | After plugging into the distillation engine |
|------|---------|--------------|
| Journal generator | Write a journal by hand | Generate a daily summary automatically from Episodes |
| Personal assistant | General AI assistant | Match situations to Playbooks → act the way you would |
| Emotional companion | General companion chat | Reach out proactively when stress markers are detected |
| Knowledge transfer | Write knowledge docs by hand | Export Playbooks as structured knowledge |
| Skill gap analysis | Manual assessment | Analyze automatically from Ratings which areas are still at observe |

---

## Relationships between products

```
User surfaces (each independent, for end users)   Management surfaces (aggregatable, for the owner)
─────────────────────────────────   ─────────────────────────────────

visitor browser                      ┌─────────────────────────────┐
  → digital-avatar showcase Web      │  Management center (Electron gateway) │
                                     │                              │
user device                          │  ┌── Distillation engine mgmt (built in) │
  → journal generator App            │  │   Playbook browse/edit      │
                                     │  │   proactive questions/execution approval │
user device                          │  │   ingestion adapter mgmt    │
  → personal assistant App           │  │                           │
                                     │  ├── Digital-avatar showcase mgmt (embedded) │
                                     │  │   content/invite code/role mgmt │
                                     │  │                           │
                                     │  ├── Journal generator mgmt (embedded) │
                                     │  │   journal format/source config │
                                     │  │                           │
                                     │  └── Personal assistant mgmt (embedded) │
                                     │      execution permissions/history │
                                     └──────────┬──────────────────┘
                                                │
                                     Management API + Memory Protocol
                                                │
                                     ┌──────────┴──────────────────┐
                                     │  Distillation engine (platform) │
                                     │  ingest→filter→distill→memory→execute │
                                     └──────────┬──────────────────┘
                                                │
                                     Memory Protocol (JSON Schema)
                                                │
                                  ┌─────────────┼─────────────┐
                                  ▼             ▼             ▼
                        Digital-avatar   Journal         Personal
                        showcase         generator       assistant
                        (backend+storage) (backend+storage) (backend+storage)
```

### Integration methods

**Distillation engine ↔ application**: Memory Protocol (JSON Schema + REST semantics). Applications read and write memory through the standard interface. Applications do not need to know how the distillation engine works internally.

**Management center ↔ distillation engine**: management API (distillation engine status, configuration, control) + Memory Protocol (browse/edit Playbooks). The distillation engine's management surface is built into the management center.

**Management center ↔ application**: app registration protocol (the app declares "who I am, which management pages I provide, where my management API is"). The management center loads the app's management surface and renders it as an embedded page. The app's user surface does not pass through the management center.

**Application ↔ application**: no direct communication. If cross-app correlation is needed, it goes through the distillation engine's memory — just as Grafana correlates metrics and logs through labels, not through Mimir and Loki talking directly.

### Shared conventions

| Convention | Purpose | Analogy |
|------|------|------|
| Memory Protocol JSON Schema | Memory data format (Playbook/Episode/Identity/Meta) | Elastic Common Schema |
| Observation Protocol CloudEvents | Ingestion event format | Beats' Lumberjack Protocol |
| App registration protocol | Apps declare their capabilities to the management center | Kibana Plugin API |

---

## Our own product line

```
Open source, free:
  ├── Distillation engine (AGPL)
  ├── Ingestion adapters (AGPL)
  └── Protocol specs (MIT)

Commercial products:
  ├── Electron management center
  ├── First-party apps (some free, some paid)
  │   ├── Personal assistant (free, drives traffic)
  │   ├── Digital avatar (paid)
  │   ├── Journal generator (free)
  │   └── ...
  └── Organization-layer SaaS (paid by enterprises)
      ├── Organization distillation + organization Playbooks
      ├── Capability map + task scheduling
      ├── Worker monitoring dashboard
      └── Enterprise features (knowledge retention on departure, best-practice diff, hiring suggestions)
```

---

## Where the existing code belongs

The existing StandMeet code belongs, as a whole, to the **"digital-avatar showcase" application**:

| Existing component | Belongs to | Notes |
|---------|------|------|
| server/ (Django + DRF + FastMCP) | Digital-avatar showcase | Content management + API + MCP server |
| gateway/ (Node.js + Claude Agent SDK) | Digital-avatar showcase | WebSocket gateway for Invitation Mode |
| web/ (Next.js) | Digital-avatar showcase | Visitor frontend |
| standmeet-client/ (Electron) | Digital-avatar showcase | Owner admin client |

The distillation engine and the management center are brand-new products, built from scratch.

### "Memory is content, content is memory"

The existing ContentEntry (path + JSON + visibility) and the distillation engine's Playbook (path + structured content) are essentially the same data model. When the digital-avatar showcase plugs into the distillation engine:

- Hand-written ContentEntries and distilled Playbooks are read through the same Memory Protocol
- When the AI answers, it queries uniformly without distinguishing sources
- Format compatibility comes from the JSON Schema convention, not from a shared database

---

## Development order

Follow Grafana Labs' philosophy: "Get products running independently first, then distill protocols from practice."

### Phase 1: Solidify the first product

The "digital-avatar showcase" already exists. Make sure it is complete and stable as a standalone product. This is the work of the current repo.

### Phase 2: Distillation engine MVP

New repo. Minimum viable version: ingestion (Screenpipe adapter) → signal filtering → single-layer distillation (week-level Opus) → Playbook output. No need for the full five-layer pipeline, no need for the execution layer. **Being able to distill a Playbook is enough at first.**

### Phase 3: First integration

The digital-avatar showcase plugs into the distillation engine's memory. At this point the Memory Protocol goes from paper to reality — validate and adjust the schema against real data flows.

### Phase 4: Management center

Once the distillation engine and applications exist, management complexity appears and the management center emerges naturally. It evolves from the tech stack of the existing standmeet-client (Electron), but it is a new product.

### Phase 5: More applications

Journal generator, personal assistant and so on. Each is an independent product, with its own repo, each self-contained.

---

## Application-layer paradigm: distill from use, do not design up front

### Core principles

Reference the evolution path of Claude Code (Boris Cherny / Anthropic):

- **Latent demand**: only make simpler what users already do; do not make users do new things
- **Never bet against the model**: scaffolding is temporary; do not build permanent frameworks around today's limitations
- **The Bitter Lesson**: more general solutions eventually beat more specific ones
- **Extract from repetition**: CLAUDE.md came from users writing their own markdown to feed the model; Plan mode came from users writing "don't write code yet" in prompts; Skills came from users wanting to reuse prompt patterns. The behavior always came first, then the productization

### Deriving the application layer

Application = independent product with its own backend, storage and user surface. Plugging into the distillation engine enhances the experience, but the app does not depend on it.

**Do not define an application framework now.** Wait for real repeated patterns to appear, then extract. Concretely:

**Phase 3 (first integration): call the REST API directly**

The digital-avatar showcase reads the distillation engine's memory with plain HTTP GET/POST to Memory Protocol endpoints. No SDK, no manifest, no registration protocol needed.

```python
# That simple
client = httpx.AsyncClient(base_url="http://localhost:5000")
r = await client.get("/memory/playbook/search", params={"q": query})
```

The value of this step: validate the Memory Protocol's schema, query patterns and write-back frequency. Learn from real data flows.

**Phase 4 (management center): discover apps the simplest way**

```yaml
# ~/.standmeet/apps.yaml
engine:
  url: http://localhost:5000

apps:
  - name: digital-avatar
    manage_url: http://localhost:8000/manage
    health_url: http://localhost:8000/health
```

Maintained by hand, no automatic discovery. Just as CLAUDE.md is hand-written.

**Phase 5+ (when the second application appears): extract from repetition**

The second application also needs to call the Memory Protocol, also needs to register in the config, and also needs to provide a manage_url. Only then look at what is worth abstracting:

- Repeated REST calls → a lightweight SDK
- Repeated config format → a simple manifest
- Repeated management UI patterns → a webview loading convention

The time to extract is "the second repetition", not "the first prediction".

### Reference implementations (notes, no rush to use)

These are mature solutions already researched, kept as references for Phase 5+ when latent demand appears:

**Shopify Apps** (closest to our architecture — an app is an independent service):
- App = independent web service with its own backend and database
- Data access: REST/GraphQL + OAuth scoped token
- UI embedding: iframe + App Bridge SDK
- Capability declaration: `shopify.app.toml` (scopes, webhooks, surfaces)

**Claude Code Skills** (the lightest extension paradigm):
- Skill = one SKILL.md file + a directory
- Three-level progressive loading: metadata (~100 tokens) → full instructions (<5k tokens) → bundled resources (on demand)
- Selection is pure LLM reasoning; there is no routing system
- Anthropic's position: "Don't build agents, build skills"

**VS Code Extensions** (declarative UI registration):
- `contributes` declares commands/views/settings in the manifest
- `activationEvents` for lazy loading

**Home Assistant Integrations** (guided installation):
- Config Flow multi-step setup wizard

**Grafana App Plugin** (source-level analysis, see the original product-split.md):
- 10 mechanisms: app discovery pipeline, frontend route proxy, backend API proxy, navigation registration, app settings storage, extension point system, platform API, lifecycle management, permission model, health checks

These are all "tools in the toolbox". Which to use, and when, latent demand will tell us.

---

## Open questions

1. **Memory Protocol versioning strategy**: validate and adjust the schema against real data flows during the Phase 3 integration; no rush to freeze v1.

2. **When to split the existing repo**: it is fairly certain the distillation engine gets a new repo. Should the existing monorepo be split?

3. **Technical implementation of the management center**: decide in Phase 4. iframe/webview/React micro-frontends — choose once there is a real scenario.
