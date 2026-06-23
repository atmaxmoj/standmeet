# 三层 ACL —— 测试设计

> **状态：** 设计定稿（2026-06-20，2026-06-23 对齐纯 AND·deny 模型）。配 [`capability-acl-hierarchy.md`](capability-acl-hierarchy.md)（业务 + 代码架构）。本文件只管**测什么、怎么测、跟现有怎么结合**。
> **模型（A.4 落定）：** 纯 AND、code 只能 deny。`exposed = global_on ∧ (roleGranted \ codeDenied) ∧ connector ∧ quota`。没有 tri-state allow —— 所有"code 反向 allow / 复活"的行与 corner 已删，测面比初稿小。
> **节奏：** 红先行 —— 先把本文列的全部 spec 写成红，再实现，最后全绿（同 Phase A..H）。
> **铁律：** e2e only（真 service、真 DB、无 mock 外部依赖）；唯一例外是 §A 的纯解析真值表走 domain 单测（无 IO，是整套的"真值之锚"）。

---

## 0. 怎么跟现有测试结合（先定边界）

新测试**不另起炉灶**，落进现有 e2e 体系：

| 维度 | 复用什么 | 加什么 |
|---|---|---|
| 跑法 | `make test` / `make test-only SPEC=acl`（现有 Makefile，workers=1，resetInstance per spec） | 不加新 recipe |
| 颁发会话 | `e2e/fixtures/visitor.ts` `issueSession({code})` | 不动 |
| 看 tool 暴露 | `e2e/fixtures/capabilities.ts` `sessionToolNames(token)` | 不动（这是"X 在不在这个 code 的 session 里"的唯一判据） |
| 连器 corner | `e2e/fixtures/gcal-setup.ts` `seedCodeVisitorOnConnectedOwner` | 不动 |
| code / role 种子 | `e2e/fixtures/codes.ts` `roles.ts` | **加** `setCodeCapabilityDenial(req,csrf,codeId,capId)` + `setCodeSkillDenial(...)` + `clearCodeCapabilityDenial(...)`（撤销）+ `listCodeDenials(...)`（读回） |
| 文件位置 | `e2e/test/` | **加** `acl-*.spec.ts`，跟 `capability-*.spec.ts` 并排 |
| 单测真值表 | —— | **加** `internal/domain/role_snapshot_acl_test.go`（测 `AllowsCapability`） |

**回归锚（必须保持绿，证明没把"role 冻结基线"改坏）：**
`chat-book-success` · `chat-book-not-connected` · `mcp-skill-grant-booking` · `external-mcp-tools` · `retrieval-capability-state` · `session-capability-bundle` · `capability-disable-while-attached`（global 活闸）。这些一条不能红。

---

## A. 真值表（domain 单测）

被测方法 `RoleSnapshot.AllowsCapability(capID, aclAlways) bool` = `baseGrant(aclAlways ∨
allowedTools∋capID) ∧ capID ∉ deniedCapabilities`。`mcpAppGranted` 委托它，是整套 frozen 判定
的真值之锚。穷尽 baseGrant × code deny（含 ACL=always 维度）：

| # | baseGrant | code deny | exposed | 语义 |
|---|---|---|---|---|
| A1 | role-granted | — | **true** | 继承 role 授权 |
| A2 | role-granted | Y | **false** | code 撤销 role 授的 |
| A3 | 无 | — | **false** | role 未授 |
| A4 | 无 | Y | **false** | 幂等 noop |
| A5 | ACL=always | — | **true** | always 能力恒暴露 |
| A6 | ACL=always | Y | **false** | **code deny 盖过 always**（subtract 减不到，门上挡） |

外加 wire round-trip：`deniedCapabilities` marshal→unmarshal 后仍生效（冻进 session_data 不丢）。

---

## B. Happy-flow 组合矩阵（e2e）

完整暴露式：`exposed = global_on ∧ frozenAllow ∧ connector_deps ∧ quota`。本节固定 connector 已连、quota 充足，只动 global × frozen，**且 capability 与 skill 两类 target 各跑关键行**。

### B.1 global=ON，扫 4 个 frozen 行 × 2 target

| spec | target | role | code deny | 期望 |
|---|---|---|---|---|
| `acl-cap-inherit` | calendar.book | 授 | 无 | 暴露（A1，回归基线） |
| `acl-cap-code-revokes` | calendar.book | 授 | deny | **不暴露**（A2） |
| `acl-cap-none` | calendar.book | 不授 | 无 | 不暴露（A3，回归） |
| `acl-cap-code-deny-noop` | calendar.book | 不授 | deny | 不暴露（A4 幂等） |
| `acl-skill-code-revokes` | skill X | 授 | deny | **skill X 的 skill_use 不暴露**（A2·skill） |
| `acl-skill-inherit` | skill Y | 授 | 无 | skill Y 暴露（A1·skill，回归） |
| `acl-skill-none` | skill Z | 不授 | 无 | 不暴露（A3·skill 基线，对称补全） |

判据：`sessionToolNames(code 的 session)` 含 / 不含目标 tool（`calendar_book` / 该 skill 的暴露形态）。

### B.3 ACL 作用于整个 frozen 产物，不只 tool 名

code-deny 是在 frozen 之前把 cap 从 grant 集里减掉，所以它**整条都得消失**：tool spec、capability_state、system-prompt fragment / part_id / hash。锁住"减一个 cap = 它在这个 session 里彻底不存在"。

| spec | 场景 | 期望 | 锁的 |
|---|---|---|---|
| `acl-code-deny-drops-prompt-fragment` | code deny retrieval（贡献 fragment 的 cap） | 该 fragment **不在** `system_prompt_part_ids`；hash 随之变 | feature-floor：cap 贡献 fragment+part_ids+hash（对齐 `session-capability-bundle`） |
| `acl-code-deny-cap-absent-from-states` | code deny 一个 role 授的 cap | 该 cap **完全不在** `capabilities` states 里（**不是** `enabled=false`） | 两横切：ACL = 「不被发现」（ErrHidden / 不进 spec），区别于 connector/quota 的「可见但 `enabled=false` 降级」 |

> 判据扩展：除 `sessionToolNames`，这两条还读 session bundle 的 `system_prompt_part_ids` / `capabilities`（`e2e/fixtures/capabilities.ts` 已有取数）。**别只断 tool 名** —— 那样测不出 fragment 泄漏 / state 残留。

### B.2 global 是顶层 master

| spec | 场景 | 期望 |
|---|---|---|
| `acl-global-beats-role-grant` | global 关 calendar.book + role 授 + code 无 deny | **不暴露**（global 纯 deny master，盖过 frozen 的 allow，A.3） |
| `acl-global-on-frozen-decides` | global 开 + role 授 + code deny | 不暴露（global 开时由 frozen 定，验 master 只减不增） |

---

## C. 冻结 vs 活（语义不对称，两边都要锁）

| spec | 层 | 操作时序 | 期望 | 锁的不变量 |
|---|---|---|---|---|
| `acl-code-frozen-at-issue` | code | issue → 改 code deny → 同 session 下一 turn | **不变**（仍按 issue 时的） | role/code 冻结 |
| `acl-code-reissue-reflects` | code | 改 code deny → **新** issue | 新 session 生效 | 改 code 只影响后续 |
| `acl-global-live-mid-session` | global | issue → 关 global → 同 session | **立刻消失** | global 活（= 现有 `capability-disable-while-attached` 的同族，引用即可） |

> 这三条是本设计最容易写错的地方：code 改了**在跑的不动**，global 改了**在跑的立刻动**。

---

## D. 隔离（per-code，不是 per-role）

| spec | 场景 | 期望 |
|---|---|---|
| `acl-code-isolation` | 同 role 两个 code：code-1 deny X，code-2 无 deny | code-1 session 无 X；**code-2 session 有 X** |
| `acl-code-multi-deny` | 一个 code deny 两个 cap（X + Y） | X、Y **都**不暴露 | deny 是集合，不是单值 |
| `acl-code-denial-scoped-to-owner` | 拿别的 owner 的 codeId 写 deny | 404/403，互不串 |

---

## E. 错误流

| spec | 输入 | 期望 |
|---|---|---|
| `acl-deny-unknown-capid` | deny 一个不存在的 capability id | 写入不报错、解析时无匹配 → 零效果、不崩（id 永不命中已注册 cap） |
| `acl-deny-on-revoked-code` | code 已 revoke + 带 deny | session 401（现有），deny 无意义 |
| `acl-deny-missing-csrf` | 无 CSRF 头写 deny | 403（沿用 admin 鉴权，不另写逻辑） |
| `acl-deny-malformed-body` | 写 deny 缺 `capability_id`（坏 body） | 400，不写 |
| `acl-deny-duplicate-idempotent` | 同一 (code,cap) deny 两次 | 幂等（PK (code_id,capability_id)，第二次不报错、不双写） |
| `acl-deny-undo-reissue` | 写 deny → 删 deny → **重** issue | 能力**回来**（deny 可撤；reissue 反映，与 §C `acl-code-reissue-reflects` 同族） |
| `acl-deny-readback` | 写 deny 后 GET code 的 deny 列表 | 返回刚写的（admin UI 读路径，稀疏列表） |

（原 `acl-override-bad-state` 删 —— deny 没有 state 列；改由 `acl-deny-malformed-body` 守坏 body。）

---

## F. Corner cases（正交闸的交叉 —— 重点）

每条都是"code-deny 与另一道闸相遇时谁说了算"。**code-deny 只收窄授权，不去碰存在性 / 连接 / 配额。** 纯 AND·deny 下「code 反向 allow」的 corner（原 F1/F2/F3/F7）已不存在 —— 没有 allow 就没有"复活 / 越权 / 双发"。

| # | spec | 场景 | 期望 | 为什么 |
|---|---|---|---|---|
| F4 | `acl-code-deny-noop-when-role-ungranted` | role 不授 + code deny | 不暴露（无变化） | 幂等，A4 的 e2e 版。 |
| F5 | `acl-code-deny-owner-only-noop` | code deny 一个 owner-only 能力（如 seo） | visitor session 无变化、不崩 | owner-only 不在访客平面（Phase H shape 过滤）；deny 对它无意义但不能炸。 |
| F8 | `acl-public-session-no-deny-layer` | public/byoai（无 code） | 行为 = owner vanilla role，deny 层不参与 | 无 code → 无 deny 来源（回归保护）。 |

> connector / quota / `skill.Enabled` 三道正交闸跟 ACL 的交叉，由现有回归锚覆盖（`chat-book-not-connected` / quota 系列 / skill enable）—— 它们本就是"role 授了但闸不满足 → 不暴露"，纯 AND·deny 不改这层语义，无需新 corner（原 F2/F6 靠 code-allow 制造的场景已不存在）。

---

## G. 红先行实施顺序

1. **§A domain 单测**（真值表 + wire round-trip）→ 红 → 实现 `RoleSnapshot.AllowsCapability` + `mcpAppGranted` 委托它 → 绿。锚定真值。
2. **§B happy 矩阵（含 B.3 frozen 产物）** → 红 → 实现 schema + repo + `CodeDenialReader` 接进 `buildRoleSnapshotForCode`（skill 源头剔除 / cap 进 `DeniedCapabilities`）+ admin deny 写/读口 → 绿。B.3 顺带验证 fragment/part_ids/hash 与 state 缺席。
3. **§C 冻结/活 + §D 隔离 + 多 deny** → 红 → （多半 2 实现完就绿；补 isolation 的两 code 种子）。
4. **§F corner**（F4/F5/F8）→ 逐条红→绿。
5. **§E 错误流**（未知 id / revoked / 无 CSRF / 坏 body / 重复 / 撤销 / 读回）→ 红→绿。
6. **回归锚（§0）** 全程保持绿；每实现一步重跑一次。

**完成定义：** §A–§F 全绿 + §0 回归锚一条不红 + `make lint` 绿（含 docker golangci）。

---

## H. 覆盖自检（防漏）

- [ ] 真值表 4 行全测（A1–A4），含 deny-noop 幂等行。
- [ ] capability 和 skill 两类 target 都跑过"继承 / code 撤销 / 不授基线"（含 `acl-skill-none`）。
- [ ] **ACL 作用于整个 frozen 产物**：tool 名 + capability_state 缺席 + prompt fragment/part_ids/hash（§B.3），不止 tool 名。
- [ ] **「不被发现」vs「可见禁用」区别锁过**（denied → 不在 states；connector/quota → `enabled=false`）。
- [ ] 冻结（code）与活（global）两种时序都锁。
- [ ] 三道正交闸（connector / quota / skill.Enabled）由现有回归锚覆盖（不靠 code-allow 制造场景）。
- [ ] master（global）只减不增锁过。
- [ ] per-code 隔离锁过（同 role 两 code 分叉）+ 多 deny 集合。
- [ ] public/byoai 无 code 路径回归过。
- [ ] 错误流：未知 id / revoked / 无 CSRF / 坏 body / 重复幂等 / 撤销-reissue / 读回。
