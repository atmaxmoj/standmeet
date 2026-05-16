# 蒸馏引擎工程设计

理论设计见 distillation-design.md。本文定义工程实现：架构总览、编排架构、进程模型、技术选型、存储层、数据流、对外接口、崩溃恢复、云化路径。

---

## 架构总览

```
  采集适配器                                                     管理中心          应用层
  (Screenpipe/IDE/...)                                         (Electron)     (Claude Code/Cursor/...)
        │                                                          │                │
        │ ① Observation Protocol                                   │                │
        │   (CloudEvents)                                          │                │
        ▼                                                          │                │
┌───────────────────────────────────────────────────────────────────┼────────────────┤
│  蒸馏引擎 daemon（单进程）                                         │                │
│                                                                    │                │
│  ┌──────────────────────────────────────────────────────────────┐ │                │
│  │  EventBus（抄 Home Assistant）                                │ │                │
│  │  所有层间通信走事件总线，统一 TriggerProtocol                  │ │                │
│  └──────────────────────┬───────────────────────────────────────┘ │                │
│                          │                                         │                │
│  ┌──────────────────────┼───────────────────────────────────────┐ │                │
│  │  蒸馏管线                                                     │ │                │
│  │                                                               │ │                │
│  │  秒级（规则，$0）→ micro_features                             │ │                │
│  │  任务级（Haiku）→ episodes                                    │ │                │
│  │  小时级（统计，$0）→ rhythm_patterns                          │ │                │
│  │  天级（Sonnet agent loop）→ daily_digests                     │ │                │
│  │  周级（Opus agent loop）→ playbook/identity/meta              │ │                │
│  └───────────────────────────────────────────────────────────────┘ │                │
│                                                                    │                │
│  ┌──────────────────────────────────────────────────────────────┐ │                │
│  │  执行层（实时响应式）                                          │ │                │
│  │  情境匹配 → auto/suggest/observe                              │ │                │
│  └──────────────────────────────────────────────────────────────┘ │                │
│                                                                    │                │
│  ┌──────────────────────────────────────────────────────────────┐ │                │
│  │  存储层（全 SQLite，云化换 PostgreSQL）                        │ │                │
│  │  13 张表，所有表带 owner_id                                    │ │                │
│  └──────────────────────┬───────────────────────────────────────┘ │                │
│                          │                                         │                │
│  ┌──────────────────────┴───────────────────────────────────────┐ │                │
│  │  接口层（daemon 的对外边界）                                    │ │                │
│  │                                                               │ │                │
│  │  ② Memory Protocol（JSON Schema + REST 语义）                 │◄┼────────────────┤
│  │     /memory/playbook/, /memory/identity/, ...                 │ │                │
│  │                                                               │ │                │
│  │  ③ Query Protocol（REST + 向量搜索）                          │◄┼────────────────┘
│  │     /memory/episodes/search, /memory/episodes/{date}, ...     │ │
│  │                                                               │ │
│  │  管理 API                                                     │◄┘
│  │     /engine/status, /engine/questions, /engine/execution/     │
│  │                                                               │ │
│  │  Transport: 本地=直接读 SQLite / 分离部署=HTTP / 云化=HTTP+auth│
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                    │
│  LLM：LiteLLM Router（opus→sonnet→haiku fallback）                │
│  Agent Loop：Pydantic AI    并发：asyncio.Semaphore(2)            │
│  崩溃恢复：cursor + checkpoint + Target 幂等                      │
└────────────────────────────────────────────────────────────────────┘
```

**协议对应关系**（详见 protocol-architecture.md）：

| 边界 | 协议 | 方向 |
|------|------|------|
| 采集适配器 → 蒸馏引擎 | ① Observation Protocol（CloudEvents） | 入 |
| 蒸馏引擎 → 应用层/管理中心 | ② Memory Protocol（JSON Schema + REST 语义） | 出 |
| 蒸馏引擎 → 应用层/管理中心 | ③ Query Protocol（REST + 向量搜索） | 出 |

**Transport 策略**：协议定义的是语义（GET/PUT/POST + JSON Schema），transport 按部署方式选择：

| 部署方式 | Transport | 说明 |
|----------|-----------|------|
| 本地同机 | 直接读 SQLite（WAL） | 协议说"本地实现就是文件操作" |
| 分离部署 | HTTP REST（FastAPI） | 协议的 REST 语义直接对应 |
| 云化多租户 | HTTP REST + auth | PostgreSQL，走网络 |

---

## 编排架构：抄 Home Assistant

### 参考来源

| 来源 | 抄什么 | 不抄什么 |
|------|--------|---------|
| **Home Assistant**（主参考） | EventBus 事件总线 + TriggerProtocol 触发协议 + RestoreEntity 崩溃恢复 | YAML DSL、Integration 插件系统、Entity 实体模型 |
| **Dagster**（补充参考） | DaemonController 的 thread-per-concern 模型 | Materialize、IO Manager、资产图 |
| **Luigi**（补充参考） | Target 幂等性模式（写完标记，崩溃重试不重复） | 静态 DAG、文件为中心的 Target |

### EventBus

所有层间通信走事件总线，不直接函数调用。抄 Home Assistant 的 `EventBus` 设计：

```python
class EventBus:
    """抄 HA 的 homeassistant/core.py EventBus"""

    def __init__(self):
        self._listeners: dict[str, list[Callable]] = {}

    def listen(self, event_type: str, callback: Callable) -> None:
        """注册监听器。层启动时注册。"""
        self._listeners.setdefault(event_type, []).append(callback)

    async def fire(self, event_type: str, data: dict) -> None:
        """触发事件。所有注册的监听器异步执行。"""
        for callback in self._listeners.get(event_type, []):
            asyncio.create_task(callback(data))
```

事件类型：

| 事件 | 生产者 | 消费者 |
|------|--------|--------|
| `screenpipe.raw_events` | Screenpipe 轮询器 | 秒级（信号过滤） |
| `pipeline.micro_features` | 秒级 | 执行层（情境匹配） |
| `pipeline.task_boundary` | 秒级（边界检测） | 任务级 |
| `pipeline.episode_created` | 任务级 | （日志/监控） |
| `cron.rhythm` | CronTrigger 12:00/23:00 | 小时级 |
| `cron.daily` | CronTrigger 23:00 | 天级 |
| `cron.weekly` | CronTrigger 周日 03:00 | 周级 |
| `execution.result` | 执行层 | meta_ratings 更新 |

### TriggerProtocol

统一三种触发方式——轮询、事件、定时——都实现同一个 protocol：

```python
class TriggerProtocol(Protocol):
    """抄 HA 的 homeassistant/helpers/trigger.py"""

    async def async_attach_trigger(self, config: dict, action: Callable) -> Callable:
        """注册触发器，返回 detach 回调。"""
        ...

class PollingTrigger:
    """每 N 秒轮询 Screenpipe SQLite。"""
    interval: float = 5.0

class EventTrigger:
    """监听 EventBus 上的特定事件。"""
    event_type: str

class CronTrigger:
    """定时触发。cron 表达式。"""
    cron_expr: str
```

秒级用 PollingTrigger（5 秒轮询 Screenpipe），任务级用 EventTrigger（监听 task_boundary），小时/天/周级用 CronTrigger。

### 为什么抄 Home Assistant 不抄别的

- **同构问题**：HA 也是单进程 daemon，管理多种异构数据源（传感器 = Screenpipe），触发多种自动化（automation = 蒸馏管线各层），需要崩溃恢复
- **生产验证**：HA 用户量大，EventBus 架构跑了 10 年
- **不是编排框架**：Dagster/Temporal/Prefect 是编排框架，设计给数据管道/微服务，太重。我们需要的是应用内编排，不是分布式编排
- **局部 AI daemon 没有好的参考**：Screenpipe/Mem0/Khoj 都是 hand-roll，没有值得抄的编排层

---

## 进程模型

单个 Python daemon 进程，单 asyncio event loop。不搞多进程。

技术栈被工程选型锁死——Pydantic AI、LiteLLM 都是 Python，没得选。

```
standmeet-engine start
  │
  ├── 1. 初始化 EventBus
  │      创建事件总线，注册所有层的监听器
  │
  ├── 2. 初始化存储层
  │      ├── 连接 state.db（SQLite，所有蒸馏数据）
  │      │   所有表带 owner_id，本地只有一个值
  │      │   云化时换 PostgreSQL + pgvector，改连接字符串
  │      ├── 初始化 sqlite-vec 扩展（episodes 的向量索引）
  │      └── 打开 Screenpipe 的 SQLite（只读消费者）
  │
  ├── 3. 初始化 Screenpipe（嵌入式依赖）
  │      import screenpipe，在进程内启动采集
  │      Screenpipe 写自己的 SQLite，蒸馏引擎只读消费
  │
  ├── 4. 本地工具自动发现
  │      检测 ~/.gitconfig → 注册 git_log
  │      检测 ~/.zsh_history → 注册 shell_history
  │      检测 ~/Library/Safari/ → 注册 browser_history
  │      ... 扫描环境，注册到 tool_registry
  │
  ├── 5. 初始化 LLM 路由
  │      LiteLLMRouter(
  │        fallbacks={"opus": ["sonnet"], "sonnet": ["haiku"]},
  │        num_retries=3
  │      )
  │      asyncio.Semaphore(2)  ← 最多 2 个并行 LLM 调用
  │
  ├── 6. 注册 Triggers
  │      PollingTrigger(5s)   → screenpipe.raw_events → 秒级处理
  │      EventTrigger         → pipeline.task_boundary → 任务级处理
  │      CronTrigger(12,23)   → cron.rhythm → 小时级处理
  │      CronTrigger(23)      → cron.daily → 天级处理
  │      CronTrigger(Sun 03)  → cron.weekly → 周级处理
  │
  └── 7. 启动 Memory Protocol REST server
         FastAPI on localhost，暴露给管理中心和应用层
```

---

## 技术选型

| 组件 | 选型 | 理由 |
|------|------|------|
| 编排架构 | EventBus + TriggerProtocol（抄 Home Assistant） | 层间解耦，统一触发协议，单进程内编排 |
| 任务持久化 | Huey + SqliteHuey | 零外部依赖，任务队列持久化，崩溃恢复 |
| LLM 路由 | LiteLLM Router | fallback chain（opus→sonnet→haiku），自动重试 429/5xx，指数退避 0.5s→60s |
| Agent loop | Pydantic AI | typed tool 定义，运行时动态切换 model，structured output |
| 并发控制 | asyncio.Semaphore(2) | 最多 2 个并行 LLM 调用，防止 rate limit |
| REST server | FastAPI | Memory Protocol + 管理 API |
| 向量搜索 | sqlite-vec（本地）→ pgvector（云化） | 嵌入 SQLite，无外部依赖 |
| 采集层 | Screenpipe（嵌入式依赖） | 屏幕 OCR + 音频 Whisper，开源，import 进来用 |

### Huey 的角色

Huey 不负责编排逻辑——编排走 EventBus。Huey 只做两件事：
1. **任务持久化**：LLM 调用（任务级/天级/周级）入队到 SqliteHuey，崩溃后自动恢复
2. **后台执行**：长时间的 agent loop 放到 Huey worker 线程跑，不阻塞 asyncio event loop

### 排除的选项

| 排除 | 理由 |
|------|------|
| Temporal | 太重，需要独立集群 |
| Celery | 需要 Redis/RabbitMQ，桌面应用装不了 |
| Prefect | 云服务导向 |
| Dagster | 数据管道框架，不是应用内编排（但借鉴其 DaemonController thread-per-concern 模型） |
| 多进程架构 | Screenpipe 验证了单 runtime 够用，不需要复杂的 IPC |

---

## 存储层：全数据库

不用文件系统。所有数据存 SQLite（本地），设计按 PostgreSQL 能力来，云化多租户时换连接字符串。所有表带 `owner_id`。

### 数据库文件

| 文件 | 用途 | 管理者 |
|------|------|--------|
| `state.db` | 所有蒸馏数据（下面的所有表） | 蒸馏引擎 |
| `distillation.db` | Huey 任务队列 + 结果 | SqliteHuey |
| Screenpipe 的 SQLite | 原始采集数据 | Screenpipe（只读消费） |

### SQLite/PostgreSQL 兼容性策略

本地用 SQLite，云化换 PostgreSQL。SQL 语法 90% 通用，需要注意的差异：

| 特性 | SQLite | PostgreSQL | 策略 |
|------|--------|------------|------|
| 自增主键 | `INTEGER PRIMARY KEY`（自动自增） | `GENERATED ALWAYS AS IDENTITY` | 我们用 TEXT UUID 做主键，不依赖自增 |
| JSON | `TEXT` + `json_extract()` | `JSONB` + `->` / `->>` | 存 TEXT，查询用 Python 层处理，不在 SQL 里查 JSON |
| 向量 | sqlite-vec `FLOAT[768]` | pgvector `vector(768)` | 必须抽 storage interface，API 完全不同 |
| 布尔 | 0/1（无真 BOOLEAN） | true/false | 写入统一用 0/1，PG 会自动转 |
| 时间戳 | TEXT（ISO8601） | `TIMESTAMP WITH TIME ZONE` | 统一存 ISO8601 TEXT |
| UPSERT | `INSERT ... ON CONFLICT DO UPDATE` | 同 | 两边都支持（SQLite 3.24+） |

**结论**：Schema 直接通用。真正不兼容的只有向量列（sqlite-vec vs pgvector），抽一层 VectorStore interface 即可。JSON 字段只存不查（查询在 Python 层做），避免语法差异。

### Schema

```sql
-- Playbook：playbook_files 一对多 playbook_entries
-- 原来是"一个 md 文件里塞多个情境-行动对"
-- 现在是结构化行

CREATE TABLE playbook_files (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  filename TEXT NOT NULL,         -- "debugging"，逻辑分组
  description TEXT NOT NULL,      -- 给 agent 看的一行描述
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
  situation TEXT NOT NULL,        -- 情境描述
  action TEXT NOT NULL,           -- 行动描述
  why TEXT,                       -- 推断原因
  confidence REAL NOT NULL DEFAULT 0.5,
  evidence_ids JSON,              -- 关联的 episode ids
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
  embedding BLOB,                -- sqlite-vec 向量，云化时改 vector 类型
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
  history JSON,                   -- 每周快照 [{week, d, p, m, b}, ...]
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

## 数据流：逐层 trace

### 数据消费：从 Screenpipe 读事件

Screenpipe 作为嵌入式依赖在蒸馏引擎进程内运行，采集数据写入自己的 SQLite。蒸馏引擎是该 SQLite 的只读消费者。Screenpipe 的 SQLite 是 WAL 模式，读不阻塞写。

PollingTrigger 每 5 秒轮询，通过 EventBus 分发：

```python
class ScreenpipePoller:
    """PollingTrigger 驱动，每 5 秒执行。"""

    async def poll(self):
        last_id = state_db.get_cursor('screenpipe_last_id')
        rows = screenpipe_db.query("SELECT * FROM ocr_text WHERE rowid > ?", [last_id])
        if not rows:
            return

        state_db.set_cursor('screenpipe_last_id', rows[-1].rowid)

        events = [to_cloud_event(row) for row in rows]  # 转 CloudEvents（Observation Protocol）
        await event_bus.fire('screenpipe.raw_events', {'events': events})
```

### 秒级：信号过滤 + 微操提取

监听 `screenpipe.raw_events` 事件。同步、纯规则、零 LLM。

```python
class SecondLevelProcessor:
    """监听 screenpipe.raw_events，产出 micro_features 和 task_boundary。"""

    def __init__(self, event_bus: EventBus):
        event_bus.listen('screenpipe.raw_events', self.handle)

    async def handle(self, data: dict):
        events = data['events']

        # 信号过滤：5 个检测器，过滤 ~90% 噪音
        filtered = signal_filter.process(events)

        # 微操提取
        micro_features = micro_extractor.extract(filtered)
        state_db.bulk_insert('micro_features', micro_features)

        # 广播微操事件（执行层监听）
        await event_bus.fire('pipeline.micro_features', {'features': micro_features})

        # 检测任务边界 → 触发任务级
        for chunk in boundary_detector.detect(filtered):
            await event_bus.fire('pipeline.task_boundary', {'chunk': chunk})
```

- `SignalFilter.process(events)` — 5 个检测器（修正、选择、停顿、放弃、压力），给事件打标签，无标签的丢弃
- `MicroExtractor.extract(filtered)` — 从有标签的事件生成 micro_features 行
- `AvoidanceDetector.update(events)` — 跨事件统计"可用但未使用"
- `BoundaryDetector.detect(filtered)` — 检测任务边界（上下文大切换、git commit、长停顿）

写入：`INSERT INTO micro_features`。必然写，有事件就有产出。

### 任务级：Haiku 单次调用

监听 `pipeline.task_boundary` 事件，入队到 Huey 执行：

```python
class TaskLevelProcessor:
    """监听 pipeline.task_boundary，Haiku 做序列摘要。"""

    def __init__(self, event_bus: EventBus):
        event_bus.listen('pipeline.task_boundary', self.handle)

    async def handle(self, data: dict):
        chunk = data['chunk']
        # 入队到 Huey，不阻塞 event loop
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

一天约 50 个 chunk，~$0.05/天。必然写——每个 chunk 必产出一条 episode。

### 小时级：纯统计

CronTrigger 12:00/23:00 触发，通过 `cron.rhythm` 事件：

```python
class RhythmProcessor:
    """CronTrigger 驱动，纯统计，零 LLM。"""

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

零 LLM，必然写。

### 天级：Sonnet Agent Loop

CronTrigger 23:00 触发。Pydantic AI agent，多轮，典型 4-8 轮。入队到 Huey 执行。

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
    # 注入 Playbook 索引到 system prompt
    playbook_index = state_db.query(
        "SELECT filename, description, maturity, entry_count FROM playbook_files"
    )

    result = day_agent.run_sync(
        f"分析 {today()} 的行为数据",
        model="sonnet",
        message_history=restore_checkpoint("daily", today()),
    )
```

必然写日报（daily_digests），insight 数量不定。建议但不直接写 Playbook——留给周级确认。

每次 tool_use 完成后自动存 checkpoint 到 agent_checkpoints 表。

### 周级：Opus Agent Loop

CronTrigger 周日 03:00 触发。工具集最大，典型 8-15 轮。入队到 Huey 执行。

```python
week_agent = Agent(
    model=litellm_router,
    system_prompt=WEEK_DISTILL_PROMPT,
    tools=[
        # 读
        read_day_report,     # SELECT FROM daily_digests
        drill_down,           # episode → micro_features 逐层下钻
        find_similar,         # SELECT FROM episodes ORDER BY embedding <-> $vec
        read_playbook,        # SELECT FROM playbook_files JOIN entries
        read_meta,            # SELECT FROM meta_ratings / meta_gaps

        # 写 Playbook（agent 自主决定是否写）
        update_playbook,      # UPDATE playbook_entries / INSERT
        create_playbook,      # INSERT INTO playbook_files + entries

        # 写 Identity（更稀少）
        update_identity,      # UPDATE identity SET content = ?

        # 写 Meta
        update_confidence,    # UPDATE meta_ratings
        update_rating,        # 计算 d(t)/p/m(t)/b，UPDATE meta_ratings
        mark_episode_absorbed,# UPDATE episodes SET absorbed = true

        # 本地工具（自动发现的，因人而异）
        *tool_registry.get_all(),
    ],
)

@huey.task()
def distill_weekly():
    result = week_agent.run_sync(
        f"分析 {this_week_range()} 的行为数据",
        model="opus",
        message_history=restore_checkpoint("weekly", this_week()),
    )
```

---

## 写入模式

关键区分：管道式确定性写入 vs agent 自主性写入。

### 确定性写入（数据进来必然产出）

| 层 | 写入表 | 触发方式 | 频率 |
|---|--------|---------|------|
| 秒级 | micro_features | PollingTrigger 每 5 秒 | 有事件就写 |
| 任务级 | episodes | EventTrigger task_boundary | 每个 chunk 必产出 |
| 小时级 | rhythm_patterns | CronTrigger 12:00/23:00 | 每天 2 次 |
| 天级 | daily_digests | CronTrigger 23:00 | 每天 1 次 |
| 执行层 | meta_ratings (prediction_accuracy) | 每次执行后 | 实时 |

### 自主性写入（agent 决定是否写）

| 层 | 写入表 | 条件 |
|---|--------|------|
| 天级 | episodes (insight) | Sonnet 觉得有值得记录的发现才写，数量不定 |
| 周级 | playbook_files + entries | Opus 觉得有新模式（≥3 次同类情境）才创建，已有条目需要修正才更新 |
| 周级 | identity | 发现跨领域共性才更新，很稀少 |
| 周级 | meta_ratings (d/m/b) | 必然写评级更新 |
| 周级 | episodes (absorbed) | 吸收进 Playbook 的才标记 |

---

## 执行层

实时响应式，和蒸馏管线的定时批处理完全不同。监听 `pipeline.micro_features` 事件。

```
pipeline.micro_features 事件到达
  → Haiku 做情境匹配
    → SELECT FROM playbook_entries WHERE situation LIKE ...
    → SELECT execution_mode FROM meta_ratings WHERE playbook_filename = ...
  → 按 execution_mode 分流：
      "auto"    → agent 直接执行 → 完成后通知用户
      "suggest" → 草拟方案 → 推给管理中心 → 用户确认才执行
      "observe" → 不做，只记录

执行完成后通过 EventBus fire execution.result：
  accept → UPDATE meta_ratings SET prediction_accuracy += ...
  modify → INSERT INTO meta_corrections + UPDATE meta_ratings
  reject → UPDATE meta_ratings SET prediction_accuracy -= ...
           连续 3 reject → execution_mode 降级

降级是实时的（一次 reject 立即 auto→suggest）
升级等周级（连续 2 周满足全部 5 个条件）
```

---

## 对外接口

协议定义见 protocol-architecture.md。蒸馏引擎实现其中三个协议：

| 方向 | 协议 | 蒸馏引擎的角色 |
|------|------|--------------|
| 入 | ① Observation Protocol（CloudEvents） | 消费者：接收采集适配器的原始事件 |
| 出 | ② Memory Protocol（JSON Schema + REST 语义） | 提供者：暴露记忆数据给管理中心和应用层 |
| 出 | ③ Query Protocol（REST + 向量搜索） | 提供者：暴露查询接口给管理中心和应用层 |

### 蒸馏引擎自己的管理 API

不属于协议，是蒸馏引擎内部的管理接口：

```
GET  /engine/status                      → 采集状态、管线进度、记忆统计
GET  /engine/questions                   → meta_gaps WHERE asked=false ORDER BY priority
POST /engine/questions/{id}/answer       → INSERT episodes(type='user_explanation') + UPDATE meta_gaps
POST /engine/execution/{id}/approve      → 执行审批
GET  /engine/execution/history           → 执行历史
```

### SQLite 并发安全

蒸馏引擎是 state.db 的唯一写入方。外部消费方（管理中心、MCP server）如果本地同机部署，可以直接只读打开 state.db（协议说"本地实现就是文件操作"）。

参考 SkyPilot 踩坑经验：
- WAL 模式必须开（`PRAGMA journal_mode=WAL`）
- `busy_timeout` 设 60 秒（不是默认 5 秒）
- 蒸馏引擎是唯一写入方，消费方只读，不存在写写冲突

---

## 崩溃恢复

四层保障，借鉴 Luigi Target 幂等模式（写完才标记完成，崩溃重试不重复）：

1. **Screenpipe 游标** — state.db 里一个 cursor 值（last rowid），重启从上次位置继续，不丢不重
2. **Huey 任务持久化** — distillation.db（SqliteHuey），未完成任务重启自动恢复队列
3. **Agent checkpoint** — agent_checkpoints 表，每次 tool_use 后存 message_history，崩溃后从最后 checkpoint 继续，不用重跑整个 agent loop
4. **Target 幂等** — 每个写入操作先检查目标是否已存在（如 daily_digests 的 UNIQUE(date)），存在则跳过，不重复写

---

## 云化路径

| 本地 | 云化 |
|------|------|
| SQLite state.db | PostgreSQL |
| sqlite-vec | pgvector |
| SqliteHuey distillation.db | RedisHuey 或 Celery |
| 单进程 daemon | K8s pod |
| owner_id 固定一个值 | 多租户 |
| localhost REST | 公网 REST + auth |

Schema 不变，所有表已有 owner_id。向量列通过 VectorStore interface 隔离，其余 SQL 语法 100% 兼容。

---

## 成本

```
秒级：  $0（纯规则）
任务级：$0.05/天（Haiku，~50 次）
小时级：$0（统计）
天级：  $0.03/天（Sonnet，4-8 轮）
周级：  $0.15-0.40/天均摊（Opus，8-15 轮）
执行层：$0.07/天（Haiku 匹配 + Sonnet 草稿）
─────────────────
总计：  ~$0.30-0.55/天 ≈ $10-17/月/用户
```
