# 协议规范

四个协议定义产品间的通信边界。协议全部开源（MIT），实现灵活授权。

产品架构和产品定义见 product-vision.md。许可证策略见 licensing.md。

---

## 产品架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                  │
│  ┌──────────────┐    ① Observation Protocol (CloudEvents)       │
│  │  采集适配器    │─────────────────────────────────────────┐     │
│  │  Screenpipe   │    任何符合协议的采集器都可以接入         │     │
│  │  IDE 插件     │                                          │     │
│  │  移动端传感器  │                                          │     │
│  │  自定义适配器  │                                          │     │
│  └──────────────┘                                          │     │
│                                                             ▼     │
│  ┌──────────────────────────────────────────────────────────┐     │
│  │  蒸馏引擎                                                 │     │
│  │  信号过滤 + 多层管线（秒/任务/小时/天/周）                  │     │
│  │  Playbook 评级更新                                        │     │
│  └──────────────────────────┬───────────────────────────────┘     │
│                              │                                    │
│                    ② Memory Protocol (JSON Schema + REST 语义)    │
│                              │                                    │
│                              ▼                                    │
│  ┌──────────────────────────────────────────────────────────┐     │
│  │  记忆存储                                                 │     │
│  │  Playbook / Identity / Episodes / Meta                    │     │
│  │  符合 schema 的任何存储后端（SQLite / PostgreSQL / ...）    │     │
│  └──────────────────────────┬───────────────────────────────┘     │
│                              │                                    │
│                    ③ Query Protocol (REST + 向量搜索)             │
│                              │                                    │
│                              ▼                                    │
│  ┌──────────────────────────────────────────────────────────┐     │
│  │  执行引擎                                                 │     │
│  │  情境检测 + Playbook 匹配 + Agent Loop + MCP 工具          │     │
│  └──────────────────────────┬───────────────────────────────┘     │
│                              │                                    │
│       个人栈（全部开源，MIT） │                                    │
│ ─────────────────────────────┼──────────────────────────────────  │
│       组织栈（商业化）        │                                    │
│                              │                                    │
│                    ④ Organization Protocol (A2A 启发)             │
│                              │                                    │
│                              ▼                                    │
│  ┌──────────────────────────────────────────────────────────┐     │
│  │  组织层                                                   │     │
│  │  能力地图聚合 + 跨人任务调度 + 组织蒸馏                     │     │
│  └──────────────────────────────────────────────────────────┘     │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## ① Observation Protocol — 基于 CloudEvents

### 为什么是 CloudEvents

- CNCF 标准，专门定义事件数据格式
- SDK 覆盖：Go、Java、JS/TS、Python、C#、Rust、Ruby
- 生态：Kafka、NATS、RabbitMQ、Knative 原生支持
- 规范简单：JSON envelope + 几个必填字段，5 分钟学会
- 本地场景当 JSON schema 用，不需要跑 event broker
- 以后有远程场景（手机 → 桌面）transport binding 现成

### 对社区贡献者的价值

**想写一个新采集适配器，只要输出 CloudEvents 格式就能接入，不需要看内部代码。**

### 事件格式

所有观测事件共享 CloudEvents envelope，`type` 字段区分事件类别：

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

### 事件类型定义

#### 信号事件（信号过滤层输出）

```
standmeet.signal.correction        修正（写了→删→重写）
standmeet.signal.selection          选择（多选项→选了一个）
standmeet.signal.sequence           顺序（做事的先后路径）
standmeet.signal.pause              停顿（长时间无操作→突然大动作）
standmeet.signal.abandonment        放弃（开始→中途放弃→换方向）
standmeet.signal.avoidance          回避（可用但未使用）
standmeet.signal.pressure           压力（频率突变、跳过常规步骤）
standmeet.signal.task_boundary      任务边界（上下文大切换、commit）
```

#### 信号事件 data 通用字段

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
    ...  // 每种 signal_type 有自己的 detail schema
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

#### 原始观测事件（采集适配器输出，信号过滤层输入）

```
standmeet.raw.screen_text           屏幕文本变化
standmeet.raw.audio_transcript      音频转录
standmeet.raw.app_switch             应用切换
standmeet.raw.keystroke_stats        击键统计（不含内容，只含速率/删改率）
standmeet.raw.file_change            文件修改
standmeet.raw.clipboard              剪贴板变化
```

原始事件量大、噪音多。信号过滤层消费原始事件，产出信号事件。蒸馏引擎只消费信号事件。

### 适配器注册

每个采集适配器在启动时发送一个注册事件：

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

蒸馏引擎可以据此知道当前有哪些采集源在线。

---

## ② Memory Protocol — JSON Schema + REST 语义

### 设计原则

- 用 JSON Schema 严格定义每种记忆的结构
- 用 REST 语义描述操作（GET/PUT/POST/DELETE/PATCH）
- **本地实现就是文件操作**，不需要跑 HTTP server
- Schema 是协议的核心——符合 schema 的任何存储后端都兼容

### 资源路径

```
/memory/
├── playbook/{filename}              GET / PUT / DELETE
├── identity/{filename}              GET / PUT
├── episodes/{date}                  GET / POST（追加）
├── episodes/search                  POST（向量搜索）
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
      "description": "情境描述"
    },
    "reaction": {
      "type": "string",
      "description": "观察到的行为反应"
    },
    "why": {
      "type": "string",
      "description": "从行为推断的原因"
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
        "description": "来源 episode ID"
      }
    },
    "pressure_variant": {
      "type": "boolean",
      "description": "是否为压力变体"
    },
    "counterexample": {
      "type": "boolean",
      "description": "是否为反例"
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
      "description": "跨情境归纳出的共性"
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
      "description": "摘要文本"
    },
    "source_signals": {
      "type": "array",
      "items": { "type": "string" },
      "description": "来源 CloudEvents ID 列表"
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
      "description": "向量嵌入（可选，由存储后端生成）"
    },
    "absorbed_by": {
      "type": "string",
      "description": "被哪个 Playbook 文件吸收（固化后填入）"
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
      "description": "d(t): 本周新情境变体占比，对应 bisimulation failure type I"
    },
    "prediction_accuracy": {
      "type": ["number", "null"],
      "minimum": 0,
      "maximum": 1,
      "description": "p: 执行接受率（指数衰减加权），对应 failure type β"
    },
    "modification_rate": {
      "type": "number",
      "minimum": 0,
      "description": "m(t): 本周 Playbook 被蒸馏修改次数归一化，对应 failure type α"
    },
    "boundary_completeness": {
      "type": "number",
      "enum": [0, 0.5, 1.0],
      "description": "b: 有反例(+0.5) + 有压力变体(+0.5)，对应 failure type F"
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

## ③ Query Protocol — REST + 向量搜索

蒸馏引擎和执行引擎查询记忆存储的接口。

### 结构化查询

```
GET /memory/episodes/2026-03-13
GET /memory/episodes/2026-03-13?signal_type=correction&pressure=true
GET /memory/playbook/debugging.md
GET /memory/meta/rating
GET /memory/meta/rating?execution_mode=auto
GET /memory/meta/gaps?asked=false&priority_gte=0.8
```

### 向量搜索

```
POST /memory/episodes/search
{
  "query": "选择了更有约束的方案",
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
      "content": "技术选型：选了 TypeScript 而不是 JavaScript",
      "similarity": 0.92,
      "timestamp": "2026-03-05T14:30:00Z"
    },
    ...
  ]
}
```

### 聚合查询

```
POST /memory/episodes/aggregate
{
  "group_by": "signal_type",
  "time_range": { "from": "2026-W11", "to": "2026-W11" },
  "metrics": ["count", "avg_pressure"]
}
```

### 本地工具查询（透传）

本地工具不通过 Memory Protocol——蒸馏引擎和执行引擎直接调用本地工具（git_log、shell_history 等）。这些工具是 agent 的 tool_use，不是记忆存储的一部分。

---

## ④ Organization Protocol — A2A 启发

### 背景

Google A2A（Agent-to-Agent）协议做的事情：agent 广播自己的能力（Agent Card）、接收任务、返回结果。StandMeet 组织层的需求和 A2A 高度一致。

### Agent Card（从 Playbook Rating 自动导出）

每个用户的 agent 定期发布自己的能力卡片：

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

注意：Agent Card **只暴露能力标签和评级数值**，不暴露 Playbook 内容。数据隔离在协议层保证。

### Task 对象

组织层下发任务给个人 agent：

```json
{
  "task_id": "org-task-20260313-001",
  "type": "standmeet.org.task",
  "title": "客户 ABC 合作方案",
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

### Flow Record（流转记录，组织蒸馏的输入）

任务完成后，自动生成流转记录：

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

Flow Record **只记录角色、时间、模式、修改次数**，不记录具体内容。组织蒸馏基于这些元数据发现协作模式，不需要看每个人具体做了什么。

---

## 协议版本管理

```
每个协议独立版本号：
  Observation Protocol v1.0
  Memory Protocol v1.0
  Query Protocol v1.0
  Organization Protocol v1.0

向后兼容策略：
  - 新增字段：可选字段，旧实现忽略
  - 删除字段：先标记 deprecated，下个大版本移除
  - 破坏性变更：大版本号 +1

Schema 发布：
  所有 JSON Schema 发布在公开 URL
  例：https://schema.standmeet.dev/v1/playbook-entry.json
  实现方可以直接引用做校验
```
