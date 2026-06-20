# 能力可见性 —— global / role / code 三层 ACL（继承 + 覆盖）

> **状态：** 设计中（2026-06-20 起草）。是 [`platform-architecture.md`](platform-architecture.md) 里"权限（ACL）横切 controller"的细化落地。
> **范围：** 把"一个访客到底能看到哪些能力 / corpus / skill"从现在的**单层 per-role 冻结**，扩成 **global → role → code 三层继承 + 覆盖**。
> **前置：** Phase H（`capability_settings` 全局开关 + 能力面板）已落地，它就是本设计的 **global 层**。读者默认读过 `CLAUDE.md` 和 RoleSnapshot 冻结那套。
> **怎么反馈：** 每块结尾编号决策点（`A.1`、`A.2`…）。回 `Aₙ: accept` / `Aₙ: change — <理由>`，没提到的视作 accept。

---

## TL;DR

一个访客能不能看到能力 X，按**三层闸**判定，越具体越能收窄、也能反向放开：

```
exposed(X) = global_live(X)            ← 活的 master kill-switch（owner 随时关，在跑 session 立刻失效）
           ∧ frozen_acl(role ⊕ code, X) ← issue 时冻结：role 基线，code 覆盖 role
           ∧ connector_deps_met ∧ quota  ← 已有
```

- **global** = 活的（Phase H 的 `capability_settings`）。不冻结，assemble 时实时读。
- **role** = issue 时冻结进 `RoleSnapshot` 的基线 ACL（现状）。
- **code** = **新增**：code 在自己 role 之上的 override（`+toolX` / `-toolY` / 改 corpus glob），issue 时跟 role 合并、code 赢，再冻进 RoleSnapshot。

"继承 + 覆盖"落在 **role ↔ code** 这一对：code 默认继承 role；code 显式 allow 能翻 role 的 deny，反之亦然。global 是叠在最上面的活 master，不参与冻结。

---

## 1. 为什么三层语义不对称（freeze vs live）

这是本设计的**核心张力**，必须先讲清，否则会撞坏现有不变量。

| 层 | 冻结/活 | 理由 |
|---|---|---|
| **global** | **活** | owner 在能力面板一关，**在跑的 session 也要立刻消失**（`capability-disable-while-attached` 锁的就是这个）。冻结就没了这语义。 |
| **role** | **issue 时冻结** | 现有核心不变量：owner 编辑 role / prompt / skill **不影响在跑 session**，只影响后续新 issue；唯一补救 = revoke code。冻结才有这性质。 |
| **code** | **issue 时冻结** | 同 role：code 的 override 也在 issue 时拍进 RoleSnapshot，session 生命周期不回读。 |

所以三层**不是**对称的"每层都是冻结基线、上层被下层继承"。准确说：

- **role ↔ code** 是一对**冻结的继承+覆盖**（code 继承并覆盖 role）。
- **global** 是叠在它们之上的**活 master kill-switch**（top-priority deny，随时生效）。

> **A.1** —— 接受这个混合语义（global 活、role/code 冻结）吗？
> 备选：global 也做成"冻结的默认基线、被 role 继承"，那 kill-switch 得另起一个独立的活层（等于四个概念）。本设计选混合，少一个概念、且不破现有冻结不变量。

---

## 2. ACL 覆盖哪些 target

现有 RoleSnapshot 里的 ACL 是四类，三层都按同一套覆盖语义作用于它们：

| target 类 | 当前存储 | 覆盖语义 |
|---|---|---|
| **capability / tool 授权** | `role.allowed_tools text[]` | tri-state per capability ID |
| **corpus 准入** | `role_corpus_uris`（path-glob，first-match-wins） | tri-state per glob 规则，规则按 specificity 排序 |
| **skill 授权** | `role_skills` | tri-state per skill ID |
| **owner MCP server** | `role_mcp_servers` | tri-state per server ID |

> **A.2** —— 第一版**只做 capability/tool + skill 两类**（离散 ID，tri-state 干净），corpus glob 的层级合并（顺序敏感、first-match-wins）单独排一个子阶段。同意分批吗？

---

## 3. resolution 代数（tri-state · 继承 + 覆盖）

每个 (scope, target) 存一个 **tri-state**：`unset(继承) | allow | deny`。

**冻结层（role ⊕ code）解析** —— 给定访客的 code → 它的 role：

```
for target T:
  s_code = setting(code, T)            # unset | allow | deny
  s_role = setting(role, T)
  effective_frozen(T) =
      s_code != unset ? s_code         # code 显式 → code 赢（覆盖 role）
    : s_role != unset ? s_role         # 否则看 role
    : default(T)                       # 都没说 → 默认
default(capability) = deny  (positive-list；要显式 grant 才有)
default(skill)      = deny
```

issue 时对每个 target 跑一遍，把 `effective_frozen == allow` 的集合冻进 `RoleSnapshot.allowedTools / skillIDs`。**RoleSnapshot 的形状不变** —— 还是一份 allow 列表，只是这份列表是 global-default? 不，是 **role ⊕ code 合并的结果**。下游 gate / skill runner 读法完全不变。

**活层（global）** —— assemble 时（每条访客消息）：

```
exposed(cap) = effective_frozen(cap) == allow     # 冻结快照里有
             ∧ NOT global_disabled(owner, cap)    # capability_settings 里没被关
```

global 只能**关**（deny），不能凭空开一个 role/code 没授权的能力 —— kill-switch 语义，不是授权来源。

> **A.3** —— global 只减不增（纯 deny master），对吗？（即"能力面板关掉" = 强制下线，但面板不能给某访客**多**开一个他 role 没有的能力 —— 那是 role/code 的活。）

---

## 4. 数据模型

**global 层（已存在，Phase H）：**
```sql
capability_settings(owner_id, capability_id, enabled, …)   -- enabled=false ⇒ global deny
```

**code override 层（新增）：** 把 role 的 grant 表"镜像"到 code，但用 tri-state（带 deny）：
```sql
-- code 对 capability 的 override（不写 = 继承 role）
code_capability_overrides(
    code_id      uuid REFERENCES access_codes(id) ON DELETE CASCADE,
    capability_id text,
    state        text NOT NULL CHECK (state IN ('allow','deny')),  -- unset = 没这行
    PRIMARY KEY (code_id, capability_id)
)
-- skill 同形态：code_skill_overrides(code_id, skill_id, state)
```
（role 层维持现状：`allowed_tools` / `role_skills`…。它仍是"role 说 allow 的集合"；缺省即该 role 不授。）

> **A.4** —— code override 用**独立 override 表**（只存跟 role 不同的部分，稀疏），不是把 role 的全套 ACL 拷一份到 code。同意吗？（稀疏 = code 编辑器只显示"相对 role 的增删"，UI 也更说人话。）

---

## 5. 代码架构 —— 改 / 留 / 删

> 原则：新设计不背老残留。下面逐块定 **KEEP（不动）/ CHANGE（改）/ ADD（新增）/ DELETE（删）**，每条点到真实文件。**这块不跟现有结构妥协拼凑** —— 该改的改干净，但要尊重一个铁律不变量：**role/code 在 issue 时冻结进 RoleSnapshot，session 生命周期不回读**。

### 5.1 合并点（唯一改动核心）

issue code-tier session 时，`buildRoleSnapshotForCode(code)` 现在直接把 `code.AssumedRoleID` 丢给 `buildRoleSnapshotByID`。code-override 就插在"拼好 role grant 集"与"`NewRoleSnapshot` 冻结"之间：

```mermaid
flowchart LR
  code["AccessCode"] --> roleGrant["buildRoleSnapshotByID<br/>role grant 集<br/>(AllowedTools / SkillIDs / CorpusURIs)"]
  ovr["code_capability_overrides<br/>code_skill_overrides"] --> merge
  roleGrant --> merge["applyCodeOverrides<br/>tri-state: code ▷ role（code 赢）"]
  merge --> snap["NewRoleSnapshot（冻结）"]
  snap --> gate["capreg assemble"]
  gset["capability_settings (global,活)"] -.->|enabledCaps 实时 deny| gate
  gate --> tools["visitor tool specs"]
```

### 5.2 改 / 留 / 删 清单

| 区块 | 文件 | 动作 | 说明 |
|---|---|---|---|
| **合并函数** | `internal/usecases/visitor_role_snapshot.go` | **CHANGE** | `buildRoleSnapshotForCode` 在拼好 role 的 `AllowedTools`/`SkillIDs` 之后、`NewRoleSnapshot` 之前，调新增的纯函数 `applyCodeOverrides(roleTools, roleSkillIDs, overrides)`。owner-vanilla（public/byoai）路径**不**走 override（没有 code），保持现状。 |
| **override 解析** | `internal/domain/code_override.go`（新） | **ADD** | 纯 domain 函数 `ResolveACL(roleGranted []string, overrides []CapOverride) []string`：tri-state 合并，code allow/deny ▷ role。无 IO、可单测。tri-state 解析代数（§3）就落这里，是整套唯一的"真值表"，别散到各处。 |
| **override 读取** | `internal/postgres/code_override.go`（新）+ `db/queries/code_overrides.sql` | **ADD** | `ListCodeCapabilityOverrides(codeID)` / `ListCodeSkillOverrides(codeID)`。issue 时一次性读，喂给合并函数。 |
| **schema** | `db/schema.sql` | **ADD** | `code_capability_overrides` / `code_skill_overrides` 两张稀疏表（§4）。**纯加表**，不动 `roles` / `access_codes` 现有列。 |
| **RoleSnapshot 本身** | `internal/domain/role_snapshot.go` | **KEEP** | 形状不变 —— 还是冻结后的 allow 列表。合并在它**之前**发生，它不知道有 override 这回事。**这是关键：下游零改动。** |
| **下游 gate** | `capreg` `enabledCaps` / booker `bookerSkillGranted` / `mcpAppGranted` / skill runner | **KEEP** | 全部继续读 `RoleSnapshot.AllowedTools()` / `SkillIDs()`。它们看到的就是"role ⊕ code 合并后的结果"，分不出也不需要分出是 role 给的还是 code 给的。 |
| **global 层** | `capability_settings` + `enabledCaps` 活 gate | **KEEP** | Phase H 已做。它是叠在冻结快照之上的活 master，跟本期合并逻辑正交。 |
| **admin: code 编辑** | `internal/routes/admin/codes.go` + 新 override 子路由 | **ADD** | code 上加"能力 override"读写（相对 role 的稀疏 +/−）。 |
| **admin: role 编辑** | role 路由 | **KEEP** | role ACL 仍是现状的 grant 列表，不动。 |
| **能力面板（global）** | `capabilities.go` + 前端面板 | **KEEP** | 本期不碰。 |

### 5.3 不留老残留 —— 要核对删的点

新设计要求"该删的删，别让老的和新的并存制造两套真值来源"。盘下来本期**没有要删的旧代码**（这是纯增量扩展，不是替换），但有两处**必须显式核对、防止退化成双源**：

- **`code.AssumedRoleID` 保留** —— code 仍靠它选 role；override 是叠在所选 role 之上，不是取代选 role。**设计如此**，不算残留。
- **不要把 override 也塞进 `RoleSnapshot` 当第四类字段** —— 一旦 snapshot 里既有"合并后 allow 列表"又有"原始 override"，就是双源、必然漂移。override **只活在 issue 那一刻的合并函数里**，合并完即抛，snapshot 只留结果。（对应 §2 的"snapshot 不变形"。）
- **skill 的 enable 仍是 `domain.Skill.Enabled`（Phase H 已厘清）** —— code-override 控的是 skill 的**授权**（这个 code 给不给用），不是 skill 的**存在/可用**（owner 全局 `skill.Enabled`）。两者正交，见 §6 corner（`acl-code-allow-cannot-resurrect-disabled-skill`）。别让 code-override 变成第二个 skill enable 开关。

---

## 6. 迁移 + 测试（红先行，跟其他 phase 同节奏）

**迁移：** 纯加表（`code_capability_overrides` / `code_skill_overrides`），不动 role 现有列 → 老 code 自然"零 override = 完全继承 role"，行为不变（向后兼容，无数据迁移）。

**测试设计单开一份：** [`capability-acl-hierarchy-tests.md`](capability-acl-hierarchy-tests.md) —— 穷尽真值表（6 行）+ happy 组合矩阵（capability/skill 两类 target）+ 冻结/活两种时序 + per-code 隔离 + 错误流 + corner（三道正交闸交叉）+ 回归锚 + 红先行顺序。本节不再重复。

---

## 7. 与 Phase H 的关系 + 本轮已落地的 global 层

本设计的 **global 层 = Phase H 已交付的东西**，外加这次深挖补的三处修正（都属 global 层正确性）：
- 装机发现的外部 MCP 插件注册成 **managed** origin（之前误成 builtin）。
- 能力面板只列**有访客面**的能力（owner-only 的 seo/writings… 不放 no-op 开关）。
- skill 行开关接**真 `skill.Enabled`**（skill runner 真读的），不是 capability_settings。

role/code 两层（本文档主体）是后续独立 phase。

---

## 决策点汇总

- **A.1** global 活 / role·code 冻结的混合语义。
- **A.2** 第一版只做 capability + skill，corpus glob 层级单独排期。
- **A.3** global 是纯 deny master（只减不增）。
- **A.4** code override 用稀疏独立表（只存相对 role 的增删）。
