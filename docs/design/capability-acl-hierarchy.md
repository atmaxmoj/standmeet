# 能力可见性 —— global / role / code 三层 ACL（纯 AND 收窄）

> **状态：** 设计定稿（2026-06-20 起草，2026-06-23 决策落定）。是 [`platform-architecture.md`](platform-architecture.md) 里"权限（ACL）横切 controller"的细化落地。
> **范围：** 把"一个访客到底能看到哪些能力 / corpus / skill"从现在的**单层 per-role 冻结**，扩成 **global → role → code 三层纯 AND 收窄**。
> **前置：** Phase H（`capability_settings` 全局开关 + 能力面板）已落地，它就是本设计的 **global 层**。读者默认读过 `CLAUDE.md` 和 RoleSnapshot 冻结那套。
> **决策落定（2026-06-23）：** A.1 accept · A.2 accept（v1 只做 capability + skill，corpus glob 延后）· A.3 accept · **A.4 改：纯 AND、code 只能 deny，砍掉 tri-state override**。三层是纯交集收窄，没有任何一层能凭空放开上层没给的——`override`/tri-state 概念全删，见 §3。

---

## TL;DR

一个访客能不能看到能力 X，按**三层闸纯 AND**判定，每层只能**收窄**（没有任何一层能放开上层没给的）：

```
exposed(X) = global_enabled(X)         ← 活的 ban 闸（owner 随时关，在跑 session 立刻失效）
           ∧ role_grants(X)            ← issue 时冻结：role 的授权基线
           ∧ NOT code_denies(X)        ← issue 时冻结：code 从 role 里再砍（只能减）
           ∧ connector_deps_met ∧ quota ← 已有
```

- **global** = 活的（Phase H 的 `capability_settings`）。不冻结，assemble 时实时读。**纯 ban**：关了大家都没，开了不表态、交给下面。
- **role** = issue 时冻结进 `RoleSnapshot` 的授权基线（现状）。
- **code** = **新增**：code 在自己 role 之上的**纯 deny**（`-toolY`），issue 时从 role 的授权里减掉，再冻进 RoleSnapshot。**code 不能 allow** —— 翻不了 role 的 deny、也加不了 role 没有的能力。

整套是**纯交集收窄**：`role 授 ∧ code 没砍 ∧ global 没关`。没有 tri-state、没有 override、没有"谁覆盖谁"——每层只会让能力**更少**。要给某 code 多一个能力 = 给它换一个授了那能力的 role（code 选 role 经 `AssumedRoleID`），不是 code 反向 allow。

---

## 1. 为什么三层语义不对称（freeze vs live）

这是本设计的**核心张力**，必须先讲清，否则会撞坏现有不变量。

| 层 | 冻结/活 | 理由 |
|---|---|---|
| **global** | **活** | owner 在能力面板一关，**在跑的 session 也要立刻消失**（`capability-disable-while-attached` 锁的就是这个）。冻结就没了这语义。 |
| **role** | **issue 时冻结** | 现有核心不变量：owner 编辑 role / prompt / skill **不影响在跑 session**，只影响后续新 issue；唯一补救 = revoke code。冻结才有这性质。 |
| **code** | **issue 时冻结** | 同 role：code 的 deny 也在 issue 时拍进 RoleSnapshot（已减好），session 生命周期不回读。 |

所以三层都是 AND 项，但**冻结/活不对称**：

- **role ∧ ¬code_deny** 是一对**冻结**的收窄（code 从 role 里减），issue 时算好冻进快照。
- **global** 是叠在它们之上的**活 ban 闸**（纯 deny，随时生效）。

> **A.1（accept）** —— 接受混合语义：global 活、role/code 冻结。global 是纯 ban AND 项（关→全没，开→交给下面），不是授权来源。

---

## 2. ACL 覆盖哪些 target

现有 RoleSnapshot 里的 ACL 是四类，三层都按同一套收窄语义（global ban / role 授 / code deny）作用于它们：

| target 类 | 当前存储 | code 收窄语义 |
|---|---|---|
| **capability / tool 授权** | `role.allowed_tools text[]` | code per-ID **deny**（从 role 授的里减） |
| **corpus 准入** | `role_corpus_uris`（path-glob，first-match-wins） | 延后（顺序敏感 glob 收窄单独排） |
| **skill 授权** | `role_skills` | code per-ID **deny** |
| **owner MCP server** | `role_mcp_servers` | 延后 |

> **A.2（accept）** —— 第一版**只做 capability/tool + skill 两类**（离散 ID，deny 集干净），corpus glob 的层级收窄（顺序敏感、first-match-wins）单独排一个子阶段。

---

## 3. resolution 代数（纯 AND · 收窄）

没有 tri-state。每层只会让能力**更少**。穷尽真值（per target）：

| baseGrant | code deny | frozen |
|---|---|---|
| Y | — | **allow**（继承） |
| Y | Y | **deny**（code 撤销） |
| N | — | **deny**（未授） |
| N | Y | deny（幂等 noop） |

`default = deny`。code **只能 deny**，`baseGrant=N` 两行恒 deny —— code 翻不出没给的。

**关键实现细节（ACL=always 决定的形态）：** capability 有一档 `ACL=always`（retrieval /
ask_visitor / summarize 等内建基础能力，**无视 role 授权恒暴露**）。它们根本不进
`allowedTools`，所以**不能靠「从 allowedTools 里减」来 deny**。因此：

- **capability**：deny 单独冻进 `RoleSnapshot.deniedCapabilities`，**在暴露门上挡**。门
  = `RoleSnapshot.AllowsCapability(capID, aclAlways)` = `baseGrant(aclAlways ∨ allowedTools∋capID)
  ∧ capID ∉ deniedCapabilities`。这是整套 frozen 判定的**真值之锚**（domain 单测 §A 锁它），
  `mcpAppGranted` 直接委托它。`baseGrant` 仍是纯 role 状态（allowedTools 不动），deny 是叠在
  门上的独立一项 —— 连 always 能力也挡得住。
- **skill**：没有 always 档。deny 在**装配源头**剔除（`filterDeniedSkills` 按 id 滤掉），
  让该 skill 的 L1 prompt / tool 授权 / skill id **一并**消失（只减 skillIDs 会漏掉 L1 prompt）。

issue 时算好冻进 `RoleSnapshot`：`deniedCapabilities` 新增一字段；`skillIDs/skillPrompts/
allowedTools` 是源头滤过的结果。下游除 `mcpAppGranted` 改成委托 `AllowsCapability`（加一项
deny 判定）外，读法不变。

**活层（global）** —— assemble 时（每条访客消息）：

```
exposed(cap) = frozenAllows(cap)                  # AllowsCapability（含 code deny）
             ∧ NOT global_disabled(owner, cap)    # capability_settings 里没被关
```

global 只能**关** —— ban 闸，不是授权来源。

> **A.3（accept）** —— global 只减不增（纯 deny master）。"能力面板关掉" = 强制下线；面板不能给某访客**多**开一个他 role 没有的能力。

---

## 4. 数据模型

**global 层（已存在，Phase H）：**
```sql
capability_settings(owner_id, capability_id, enabled, …)   -- enabled=false ⇒ global deny
```

**code deny 层（新增）：** code 只能从 role 里**减**，所以是纯 deny 集，**没有 state 列**（有行 = deny，无行 = 继承）：
```sql
-- code 砍掉 role 授的某能力（不写 = 继承 role）
code_capability_denials(
    code_id       uuid REFERENCES access_codes(id) ON DELETE CASCADE,
    capability_id text,
    PRIMARY KEY (code_id, capability_id)
)
-- skill 同形态：code_skill_denials(code_id, skill_id)
```
（role 层维持现状：`allowed_tools` / `role_skills`…。它仍是"role 说 allow 的集合"；缺省即该 role 不授。）

> **A.4（changed → 纯 AND · deny-only）** —— 砍掉原 tri-state `code_capability_overrides(state allow/deny)`，改成纯 deny 表 `code_capability_denials`（presence = deny）。code 只能收窄、不能反向 allow。稀疏（只存砍掉的），code 编辑器显示"相对 role 减掉了哪些"。**没有 allow 行 = 没有"code 复活/越权"这类 corner**（§6 测试相应瘦身）。

---

## 5. 代码架构 —— 改 / 留 / 删

> 原则：新设计不背老残留。下面逐块定 **KEEP（不动）/ CHANGE（改）/ ADD（新增）/ DELETE（删）**，每条点到真实文件。**这块不跟现有结构妥协拼凑** —— 该改的改干净，但要尊重一个铁律不变量：**role/code 在 issue 时冻结进 RoleSnapshot，session 生命周期不回读**。

### 5.1 合并点（唯一改动核心）

issue code-tier session 时，`buildRoleSnapshotForCode(code)` 现在直接把 `code.AssumedRoleID` 丢给 `buildRoleSnapshotByID`。code-deny 就插在"拼好 role grant 集"与"`NewRoleSnapshot` 冻结"之间：

```mermaid
flowchart LR
  code["AccessCode"] --> roleGrant["buildRoleSnapshotByID<br/>role grant 集"]
  dn["code_capability_denials<br/>code_skill_denials"] --> merge
  roleGrant --> merge["filterDeniedSkills（skill 源头剔除）<br/>+ DeniedCapabilities（cap 带进 snapshot）"]
  merge --> snap["NewRoleSnapshot（冻结：allowedTools / skillIDs / deniedCapabilities）"]
  snap --> gate["capreg assemble · mcpAppGranted → AllowsCapability"]
  gset["capability_settings (global,活)"] -.->|enabledCaps 实时 deny| gate
  gate --> tools["visitor tool specs"]
```

### 5.2 改 / 留 / 删 清单（as built）

| 区块 | 文件 | 动作 | 说明 |
|---|---|---|---|
| **合并点** | `internal/usecases/visitor_role_snapshot.go` | **CHANGE** | `buildRoleSnapshotForCode` 读 `deps.CodeDenials.List(code.ID)`，把 `denials` 透进 `buildRoleSnapshotByID`：skill 经 `filterDeniedSkills` 源头剔除（prompt/tool/id 一并消失），cap 的 deny 集塞进 `DeniedCapabilities`。owner-vanilla（public/byoai）传零 deny，保持现状。 |
| **真值之锚** | `internal/domain/role_snapshot.go` | **CHANGE** | RoleSnapshot 加 `deniedCapabilities` 字段（含 wire round-trip）+ `AllowsCapability(capID, aclAlways) bool` = `baseGrant ∧ ¬denied`。§A domain 单测锁它。 |
| **能力暴露门** | `internal/usecases/capreg_mcp_app.go` `mcpAppGranted` | **CHANGE** | 委托 `snap.AllowsCapability(m.ID, m.ACL==always)` —— 这样 ACL=always 的能力也能被 code deny 挡（subtract 减不掉它们）。 |
| **deny 读写** | `internal/postgres/code_denials.go`（新）+ `db/queries/code_denials.sql` | **ADD** | `CodeDenialRepo`：List/Add/Delete capability & skill。issue 时一次性读喂合并；admin 子路由写。 |
| **schema** | `db/schema.sql` | **ADD** | `code_capability_denials` / `code_skill_denials` 两张稀疏表（§4，无 state 列）。纯加表，不动 `roles`/`access_codes`。 |
| **port** | `usecases.CodeDenialReader` + `VisitorSessionDeps.CodeDenials` | **ADD** | 窄读接口（List capability/skill）；可空 = 零 deny（eval facade / 老路径向后兼容）。 |
| **下游其余 gate** | `enabledCaps` / skill runner / `AllowedTools()` / `SkillIDs()` | **KEEP** | skill 在源头已滤过；cap deny 全收口在 `AllowsCapability`。这些读法不变。 |
| **global 层** | `capability_settings` + `enabledCaps` 活 gate | **KEEP** | Phase H 已做，正交。 |
| **admin: code 编辑** | `internal/routes/admin/codes_denials.go`（新）+ `MountCodes` | **ADD** | 5 子路由：GET denials、POST/DELETE capability-denials、POST/DELETE skill-denials。owner-scope（GetByID 比对 owner → 404）。 |
| **admin: role 编辑 / 能力面板** | role 路由 / `capabilities.go` | **KEEP** | 不碰。 |

### 5.3 不留老残留 —— 要核对删的点

新设计要求"该删的删，别让老的和新的并存制造两套真值来源"。盘下来本期**没有要删的旧代码**（这是纯增量扩展，不是替换），但有两处**必须显式核对、防止退化成双源**：

- **`code.AssumedRoleID` 保留** —— code 仍靠它选 role；deny 是叠在所选 role 之上**再减**，不是取代选 role。**设计如此**，不算残留。要给 code 多一个能力 = 换一个授了那能力的 role。
- **不要把 deny 也塞进 `RoleSnapshot` 当第四类字段** —— 一旦 snapshot 里既有"减完的 allow 列表"又有"原始 deny 集"，就是双源、必然漂移。deny **只活在 issue 那一刻的合并函数里**，减完即抛，snapshot 只留结果。（对应 §2 的"snapshot 不变形"。）
- **skill 的 enable 仍是 `domain.Skill.Enabled`（Phase H 已厘清）** —— code deny 控的是 skill 的**授权收窄**（这个 code 砍不砍），不是 skill 的**存在/可用**（owner 全局 `skill.Enabled`）。两者正交。code 只能减，不会"复活"被全局禁的 skill，所以原 `acl-code-allow-cannot-resurrect-disabled-skill` 这类 corner 不复存在。

---

## 6. 迁移 + 测试（红先行，跟其他 phase 同节奏）

**迁移：** 纯加表（`code_capability_denials` / `code_skill_denials`），不动 role 现有列 → 老 code 自然"零 deny = 完全继承 role"，行为不变（向后兼容，无数据迁移）。

**测试设计单开一份：** [`capability-acl-hierarchy-tests.md`](capability-acl-hierarchy-tests.md) —— 穷尽真值表（6 行）+ happy 组合矩阵（capability/skill 两类 target）+ 冻结/活两种时序 + per-code 隔离 + 错误流 + corner（三道正交闸交叉）+ 回归锚 + 红先行顺序。本节不再重复。

---

## 7. 与 Phase H 的关系 + 本轮已落地的 global 层

本设计的 **global 层 = Phase H 已交付的东西**，外加这次深挖补的三处修正（都属 global 层正确性）：
- 装机发现的外部 MCP 插件注册成 **managed** origin（之前误成 builtin）。
- 能力面板只列**有访客面**的能力（owner-only 的 seo/writings… 不放 no-op 开关）。
- skill 行开关接**真 `skill.Enabled`**（skill runner 真读的），不是 capability_settings。

role/code 两层（本文档主体）是后续独立 phase。

---

## 决策点汇总（2026-06-23 落定）

- **A.1 accept** —— global 活 / role·code 冻结的混合语义；global 是纯 ban AND 项。
- **A.2 accept** —— 第一版只做 capability + skill，corpus glob 层级单独排期。
- **A.3 accept** —— global 是纯 deny master（只减不增）。
- **A.4 changed** —— **纯 AND、code 只能 deny**：砍掉 tri-state override，改稀疏 deny 表 `code_capability_denials` / `code_skill_denials`（presence=deny，无 state 列）。整套是 `role 授 ∧ code 没砍 ∧ global 没关` 的纯交集收窄，没有任何"反向 allow / 覆盖"。
