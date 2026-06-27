# Connector 设计（#155）

> 状态：设计稿。把「connector 做成可装配的插件」这件事定型——OpenAPI 驱动的 per-SaaS 连接器
> + 通用协议连接器，统一在「品类契约」和「凭据表单」两层会合。

## 0. 目标与定位

connector = **consumer-agnostic 的「带凭据的外部集成」**（D-8）。**不是 MCP、不是 agent 功能**；
消费者有多家：agent、平台特性、IM 网关、job-loop。

要的形态（定调）：**像 WP plugin / MCP server——谁都能自己搓一个，owner 装进自己的实例**。
不是 Nango 那种「内置 catalog、随代码发」。`Hub` 是 consumer-agnostic 底座；连接器是装上去的插件。

不抄任何 ELv2 代码/文件（Nango 是 ELv2，不碰）。蹭的是**开放标准**（OpenAPI / 通用协议），
不是某家的代码。

---

## 1. `kind` 轴：两种连接器

OpenAPI 只能描述 HTTP API；很多集成不是 HTTP（SMTP/IMAP/CalDAV）。所以连接器分两 kind：

| kind | 是什么 | 谁实现 | 凭据表单从哪来 | 覆盖面 |
|---|---|---|---|---|
| **openapi** | 某家 SaaS 的 HTTP API（Google Calendar / Stripe / SendGrid） | **作者给 spec + 绑定**（anyone 搓） | **从 spec 的 securitySchemes 派生** | per-SaaS |
| **protocol** | 通用标准协议（**SMTP** / IMAP / CalDAV / LDAP） | **我们内置一个实现** | **该协议固定字段**（手定 descriptor） | 长尾——一套通吃任何同协议服务器 |

一个**品类**可被两种 kind 满足：`calendar` = Google(openapi) 或 CalDAV(protocol)；
`mail` = SendGrid(openapi) 或 **SMTP(protocol)**。契约把 kind 抽象掉，consumer 不知道底下是 HTTP 还是 SMTP。

---

## 2. 三层结构

```
① 品类契约（StandMeet 拥有，固定）   —— 代码 consumer 对着它写
        booker → CalendarContract.ListBusy / CreateEvent
                        ▲ 谁实现？
② 连接器绑定（作者声明）            —— OpenAPI 操作 → 契约方法 的映射
        list_busy → operationId=freebusy.query + 请求/响应字段映射
                        ▲ 谁执行？
③ 通用 runtime（一个，通吃）        —— 契约调用 → OpenAPI 调用（注入 token）→ 归一返回
```

### ① 品类契约 = 现有 consumer 接口
不新发明——booker 现有的 `CalendarProxy`、mailer 现有的 `MailProxy` 本身就是归一接口：

```go
// StandMeet 拥有；consumer 只认这个，provider-agnostic。
type CalendarContract interface {
    ListBusy(ctx, conn, timeMin, timeMax) ([]BusyInterval, error)   // = 现有 FreeBusy
    CreateEvent(ctx, conn, in CreateEventInput) (EventRef, error)
    CancelEvent(ctx, conn, eventID string) error
}
```

### ② 连接器绑定（声明式 YAML，作者搓）
一个 openapi 连接器 = **SaaS 官方 OpenAPI spec + 这份绑定**。绑定就是 Merge 手工干的
「common model 映射」，我们让作者**声明式写、不写代码**：

```yaml
category: calendar
kind: openapi
spec: ./google-calendar.openapi.yaml          # SaaS 官方 spec（或 URL）
operations:
  list_busy:
    op: freebusy.query                        # OpenAPI 里的 operationId
    request: { body: { timeMin: "{{.timeMin}}", timeMax: "{{.timeMax}}", items: [{id: primary}] } }
    response: { busy: "{{.calendars.primary.busy}}" }
  create_event:
    op: events.insert
    request: { path: {calendarId: primary}, body: {summary: "{{.title}}", start: {dateTime: "{{.start}}"}, end: {dateTime: "{{.end}}"}} }
    response: { id: "{{.id}}", url: "{{.htmlLink}}" }
```

protocol 连接器没有 spec/绑定——内置实现直接满足契约。

### ③ 通用 runtime
```
booker.ListBusy
  → 查绑定 list_busy → 解析 OpenAPI operationId（拿 path+method+servers base）
  → 按 request 模板填请求 → 注入 owner 的 OAuth token → 调 API
  → 按 response 模板抽 busy[] → 归一返回
```
换 provider = 换一份 spec+绑定，booker 一行不改。

### protocol 路：内置实现（SMTP 写全）

protocol 连接器**没有 spec、没有绑定、没有 runtime 映射**——它是一段**内置 Go 代码，直接讲
协议、直接实现品类契约**，凭据表单**手定固定**。一套实现通吃任何同协议服务器。

```go
// SMTP：kind=protocol，填 "mail" 品类，直接实现 MailContract。
type SMTPConnector struct{}

func (SMTPConnector) Category() string              { return "mail" }
func (SMTPConnector) CredentialForm() CredentialForm { return smtpForm } // 固定，不从 spec 派生

// 直接实现品类契约（= mailer 认的 MailContract.Send）。
func (SMTPConnector) Send(ctx context.Context, conn Connection, m Mail) error {
    // 用 conn 存的 host/port/user/pass/tls 开 SMTP 连接，投递 m。
}

// 固定凭据表单（手定；对比 openapi 是从 securitySchemes 派生）。
var smtpForm = CredentialForm{
    AuthType: "smtp",
    Fields: []CredentialField{
        {Key: "host",     Label: "SMTP Host",    Type: "text"},
        {Key: "port",     Label: "Port",         Type: "text"},
        {Key: "username", Label: "Username",     Type: "text"},
        {Key: "password", Label: "Password",     Type: "password", Secret: true},
        {Key: "from",     Label: "From Address", Type: "text"},
        {Key: "tls",      Label: "Encryption",   Type: "select", Options: []string{"starttls", "tls", "none"}},
    },
}
```

两 kind 实现的是**同一个** `MailContract.Send`，区别只在「怎么实现」+「表单哪来」：

| | **openapi**（SendGrid/Gmail API） | **protocol**（SMTP） |
|---|---|---|
| 怎么实现契约 | 绑定声明 op→契约映射，通用 runtime 执行 HTTP | 内置 Go 直接讲 SMTP 协议 |
| 凭据表单 | 从 spec `securitySchemes` 派生 | 手定固定（上面 `smtpForm`） |
| 谁搓 | 任何人（给 spec+绑定） | 我们内置（一套通吃长尾） |
| 连接动作 | OAuth dance | 存 host/pass 即连，无 dance |

**共同抽象**（不分 kind）：一个 Connector = `{Category() 填哪个品类槽 + CredentialForm() 装配表单
+ 实现该品类契约}`。kind 只决定「怎么实现契约」和「表单哪来」，**对 consumer 完全透明**——
booker 拿到的是 `CalendarContract`、mailer 拿到的是 `MailContract`，背后 HTTP 还是 SMTP 一概不知。

---

## 3. 消费者怎么「识别对的连接器」

调研三家（Power Platform=人工接线 / GPT Actions·MCP=LLM 语义 / Merge=归一品类），共同点：
**没人从 raw OpenAPI 自动推「这是日历」——品类归属永远是声明的**。我们两类 consumer 两条路：

- **agent（LLM）** → **语义**：直接把 OpenAPI 操作 + 描述喂给它，自己读着挑（MCP/GPT 式）。
  **不需要绑定**，丢份 spec 就能给 agent 用。
- **代码 consumer（booker/mail/job-loop）** → **归一品类**：对着契约写，连接器必须**声明品类 +
  把操作映射到契约**。这接上已有的 `Requires:["calendar"]` + connectorDepRegistry 命名 provider。

→ **搓连接器的代价分两档**：只给 agent 用 = 丢份 spec；要给 booker 用 = 还得写品类绑定。

---

## 4. 凭据识别 + 表单渲染

原则（偷 Retool/Power Platform）：**spec 给「认证类型/流程」，owner 给「密钥」，表单从 type
自动生成——不是每个连接器手写表单**。

### 识别
```
openapi:  绑定用到的 operations → 它们的 security → components.securitySchemes → 按 type 映射字段
protocol: 内置的固定 descriptor（SMTP/CalDAV 各一份）
```

### 每种认证 type → 渲染字段
| 来源 / type | owner 填 | 备注 |
|---|---|---|
| openapi · **oauth2** | `client_id` + `client_secret` | token **不填**——Connect 跑 dance 自动拿；scope 多选；展示 per-connector redirect_uri 让 owner 去注册 |
| openapi · **apiKey** | 一个 key 字段 | 展示去哪（header/query + name） |
| openapi · **http basic/bearer** | user+pass / token | |
| protocol · **smtp** | `host`/`port`/`username`/`password`/`TLS`/`from` | 协议固定，不从 spec 来 |

**两个源都吐同一个 descriptor → 前端一个通用渲染器**（加任何连接器都不写新表单）：

```go
type CredentialForm struct {
    AuthType    string            // "oauth2" | "api_key" | "basic" | "bearer" | "smtp" ...
    Fields      []CredentialField
    RedirectURI string            // oauth2: 展示给 owner 注册（per-connector）
    NeedsDance  bool              // oauth2: 字段填完有个 Connect 按钮
}
type CredentialField struct {
    Key, Label, Type string       // "client_id","Client ID","password"
    Secret  bool                  // 加密存 + 打码
    Options []string              // select（scope）
    Help    string
}
```

### 提交后
- **oauth2**：存 client_id/secret（加密）→ Connect → dance → 存 token → Connected；
- **apiKey/basic/bearer/smtp**：存密钥（加密）→ 直接 Connected（无 dance）。

---

## 5. UML

### 5.1 静态结构（class/component）
```
                              consumers
   ┌──────────┬───────────┬──────────────┬───────────────┐
   │ booker   │ mailer    │ job-loop     │ agent (LLM)   │
   │ (code)   │ (code)    │ (code)       │               │
   └────┬─────┴─────┬─────┴──────┬───────┴──────┬────────┘
        │ requires  │ requires   │              │ 读 operations
        ▼ "calendar"▼ "mail"     ▼              ▼ 语义自选（无契约）
   ┌──────────────────────────────────────┐    （直接吃 OpenAPI 操作）
   │     Category Contracts (我们拥有)      │
   │   CalendarContract     MailContract    │
   │   ListBusy/CreateEvent  Send           │
   └───────────────────┬──────────────────┘
                       │ «implements»
                       ▼
   ┌────────────────────────────────────────────────┐
   │  Connector   (Hub 注册；按 category 填 DepRegistry)│
   │  kind: openapi | protocol                         │
   └──────────────┬────────────────────┬──────────────┘
             openapi                 protocol
                  │                       │
                  ▼                       ▼
   ┌───────────────────────┐   ┌────────────────────────┐
   │ Binding + OpenAPI spec │   │ Protocol impl (内置)    │
   │  op → contract 映射     │   │  SMTP / CalDAV / IMAP   │
   └───────────┬───────────┘   └───────────┬────────────┘
               │ «executed by»             │
               ▼                           │
   ┌───────────────────────┐               │
   │ OpenAPI runtime        │               │
   │ HTTP + OAuth proxy     │               │
   └───────────┬───────────┘               │
               └────────────┬──────────────┘
                            ▼
                  ┌────────────────────┐
                  │ Connection          │  owner 的凭据/token（加密）
                  │ (credential store)  │
                  └────────────────────┘
```

### 5.2 装配流（owner 在 UI 装一个连接器）
```
owner        admin UI            backend                       SaaS
 │  贴 spec/选内置 │                  │                            │
 │───────────────▶│  请求表单         │                            │
 │                │─────────────────▶│ DeriveCredentialForm        │
 │                │                  │  (securitySchemes / 协议固定)│
 │                │◀─────────────────│ CredentialForm descriptor   │
 │  填 client_id/  │  通用渲染器渲染    │                            │
 │  secret(或key)  │                  │                            │
 │───────────────▶│─────────────────▶│ 存加密凭据                   │
 │  点 Connect     │                  │  (oauth2) 跑 dance ────────▶│ authorize
 │                │                  │◀──────── code ──────────────│
 │                │                  │  换 token ─────────────────▶│ token
 │                │◀─────────────────│ 存 token → Connected         │
 │◀───「已连接」───│                  │                            │
```

### 5.3 消费流（booker 用日历，不知背后是谁）
```
booker → CalendarContract.ListBusy(conn, t0, t1)
            │
            ▼  (Connector 按 kind 分流)
   openapi:  Binding.list_busy → runtime 填请求 + 注入 token → GET freebusy → 抽 busy[]
   protocol: CalDAV impl → REPORT free-busy → 解析
            │
            ▼
   []BusyInterval  ──归一──▶  booker（provider-agnostic）
```

---

## 6. 落到现有代码（几乎无缝）
- 品类契约 = 现有 `CalendarProxy` / `MailProxy`，不新发明；
- `Requires:["calendar"]` + connectorDepRegistry = 已有的**品类绑定槽**；
- 手搓 gcal → 退化成「一份内置 openapi 绑定」，将来可删；
- 手搓 mail（SMTP）→ 变成 `kind=protocol` 的内置 SMTP 连接器。

## 7. 决策（已定）
1. **映射语言 = JSONata（只它一个）**。借现成 JSON 转换标准、不自造语法、不搞两套。
   选 JSONata 因为它**抽取+构造全包**（简单路径也就 `foo.bar`，跟 JMESPath 一样简单），且
   **AWS Step Functions（2024）拿它做「步骤间转 payload」= 我们「契约↔API 形状」同场景**、
   Node-RED 内置、IBM 出品——同场景 production 验证过；Go 库现成。JMESPath 不要（AWS 自己也从
   JSONPath 切到了 JSONata）。response 用它抽取、request 用它构造，一个语言两向。
2. **OpenAPI 版本**：**只收 3.0**（别通吃所有版本）。
3. **多个 securityScheme**：**owner 在 UI 自选**。凭据表单动态——派生时列出 spec 里所有可用
   scheme，UI 一个选择器，选哪个渲染哪套字段（OAuth2→client_id/secret+Connect；apiKey→key 字段）。
4. **绑定/spec 归属与目录**：内置随仓库发；**owner 能在自己实例 UI 上传一份** spec+绑定（自托管、
   无中心审核）；公共目录留 #156。

> 注：两条 consumer 路（agent=语义读操作 / 代码=品类契约）**都已定**，见 §3，不是决策。
> 残留的只是**排期**：先建代码契约路（booker 等着），agent 工具化路并行随后。

---

## 8. 测试计划（TDD 红契约，按区）

整套 UI/后端**从零**，且**用户上传任意 spec** → 错误/边界面巨大。~30-50 条，按区写红测（`test.fixme`，
对齐下面接口草图），实现逐区转绿。**老的 ~30 个 connector/booking e2e 是回归网，保持绿、不动。**

### 目标接口（审计后校准——区分「已有真实」和「新建」）
- **路由**：`/admin/connectors`（nav testid `admin-nav-connectors` 已有）。
- **已有真实 testid（新契约必须复用，别另起名）**：`connector-add-open`(加按钮) /
  `connector-card-{category}`(加目录里的卡，如 calendar/email/s3) / `connector-config-save`(保存) /
  `connector-field-{key}`(配置字段)。**mail 连接器自带 `mail-*` 命名空间**（`mail-host`/`mail-port`/
  `mail-save-credentials`/`mail-verified`/`mail-disconnect`…），不是 `connector-*`。
- **新建 testid（spec-driven 流，要建）**：`connector-spec-input`(粘/传 spec) / `connector-spec-submit` /
  `connector-spec-error` / `connector-candidate` / `connector-scheme-select`(多 scheme) /
  `connector-connect-button` / `connector-status`(connected|not) / `connector-disconnect-button` /
  `connector-redirect-uri`(只读) / `connector-error`。
- **REST（agents 收敛，泛化现有 gcal 那套到 `{id}`）**：
  `POST /api/admin/connectors`（openapi `{spec,binding}` | protocol `{kind,protocol,category}` → `201 {id}`，
  4xx `{error}`）/ `POST …/{id}/credentials`(回应打码) / `POST …/{id}/connect`（oauth 回 `{auth_url}`，
  protocol 回 `{connected}`）/ `GET …/{id}/status`(`{id,category,kind,has_credentials,connected}`) /
  `POST/DELETE …/{id}/disconnect` / `GET /api/admin/connectors`(`{connectors:[…]}`)。
  运行时直验 diag：`POST /internal/diag/connector/{id}/{list-busy,create-event}`。
- **mock 端（要建，job-board-mock 里加）**：`/__mock/oauth/*`(可编程 authorize/token，覆盖 deny/
  invalid_client/state/network) / `/__mock/caldav/{id}/{events,fail,reset}` / 扩 `/__mock/smtp/*`。
- **品类契约**：`CalendarContract.{ListBusy,CreateEvent,CancelEvent}` / `MailContract.Send`（= 现有 proxy）。

> 审计未决：①SMTP 走 `mail-*`(已有) 还是迁到 `connector-*`(新统一)——实现时定，红测两套都先挂着；
> ②`connector-card-{category}`(目录卡) vs 新契约里的 `connector-row-{category}`(已装槽位行)是两个视图，保留。

### 区（happy + err；标 phase）
- **A 摄入**：合法 3.0 解析✓ ／ 畸形 ／ 非 3.0 拒 ／ 无 servers/operations ／ URL 失败 ／ 超大。
- **B 凭据表单派生**：oauth2/apiKey/basic/bearer 各渲染对 ／ **多 scheme 选择器** ／ 无 scheme ／ 不支持 type。
- **C JSONata 绑定**：request 构造✓ ／ response 抽取✓ ／ 语法错装配拒 ／ 运行时缺字段优雅 ／ op 不存在 ／ 未知 category ／ 没映全。
- **D 连接流**：oauth2 dance✓ ／ 非 dance✓ ／ 用户拒同意 ／ client 错换 token 败 ／ state/CSRF ／ 网络断 ／ redirect_uri 展示 ／ 重连/轮换 ／ 断开。
- **E protocol(SMTP)**：填表→连接测试✓ ／ host/port 错 ／ 认证错 ／ TLS 不符。
- **F 消费闭环**：openapi calendar→booker book✓ ／ **非 gcal calendar→booker 一行不改✓**(品类归一命门) ／ SMTP→发信✓ ／ 运行时 5xx 降级 ／ 响应形状不符兜底 ／ dep-gating 连/断。
- **G 上传/管理**：上传自定义 spec+绑定→装配✓ ／ 内置 vs 上传 ／ 重名覆盖 ／ 删除→cap 复闸。
- **H 安全**（用户上传逼出来）：⚠️ **SSRF**（spec `servers` 指内网→拒/校验）／ 凭据永不外泄(扩 handle_contract) ／ per-owner 隔离。

### 第一期（先打主干）
**A+B+D+F 的 happy** 打通「上传 spec → 派生表单 → OAuth → booker 跑非-gcal calendar」主干；
**C/E/G/H + 各区 err** 随后。

---

## 9. 红测已假设的设计决策（实现时确认/可调）

§8 红测把设计留白的地方钉成了可测契约。实现前过一遍：

- **品类槽位规则**（§1 一品类两 kind）：一个品类槽**同时只一个 active connector**，owner **显式 activate**；连第二个**不自动抢槽**；active 断开 → **回退到另一个 connected 候选**（⚠️ 或改成「不回退、复闸、owner 重选」——红测里留了 alt 断言）。dep-gating 绑「至少一个 active connected」，不绑具体 provider。
  - 新 REST：`POST /api/admin/connectors/{id}/activate`；status/list 行带 `active` bool。
- **agent 工具化机制**（§3 第二条 consumer 路）：**opt-in**（建连接器时 `expose_as_agent_tools:true`）；工具名 `op_<operationId>`（点→下划线，D-3 snake_case）；描述取 operation `summary`；**per-op ACL 跟 cap 同闸**（连上 + 被 grant 才暴露）；**category-only 连接器不漏 raw ops**（只暴露归一 cap）。
  - 新 diag：`POST /internal/diag/connector/{id}/agent-call`（返 raw SaaS 响应，agent 路无契约）。
- **disconnect 保留凭据**（不清除）—— 跟现有 `admin-gcal-disconnect` 一致，一键重连不重填。
- **spec 摄入**：external `$ref` **拒**（无中心 fetch）；只收 **3.0**；YAML/JSON 同 parse 路；size 上限拒超大。
- **openIdConnect ≈ oauth2**（派生同形，多 discovery URL 提示）。
- **凭据派生**：scheme 多选 owner 自选；oauth2 选中的 scope **真带进 dance**（mock 录 authorize scope 验）。
- **要建的 mock 端**（job-board-mock 里）：`/__mock/oauth/*`（可编程 authorize/token + 录 scope/调用数）、
  `/__mock/sendgrid/*`、`/__mock/caldav/{id}/*`、`/__mock/ssrf/*`，+ gcal `set_freebusy_raw`/`set_event_shape`。
- **新 diag**：`POST /internal/diag/connector/{id}/send`（mail 版，对应 list-busy/create-event）。

> 这些都在红测里写死成断言了——实现时要么照做转绿，要么改设计 + 改对应红测。

