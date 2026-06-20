# 三层 ACL —— 测试设计

> **状态：** 设计中（2026-06-20）。配 [`capability-acl-hierarchy.md`](capability-acl-hierarchy.md)（业务 + 代码架构）。本文件只管**测什么、怎么测、跟现有怎么结合**。
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
| code / role 种子 | `e2e/fixtures/codes.ts` `roles.ts` | **加** `setCodeCapabilityOverride(req,csrf,codeId,capId,state)` + `setCodeSkillOverride(...)` |
| 文件位置 | `e2e/test/` | **加** `acl-*.spec.ts`，跟 `capability-*.spec.ts` 并排 |
| 单测真值表 | —— | **加** `internal/domain/code_override_test.go` |

**回归锚（必须保持绿，证明没把"role 冻结基线"改坏）：**
`chat-book-success` · `chat-book-not-connected` · `mcp-skill-grant-booking` · `external-mcp-tools` · `retrieval-capability-state` · `session-capability-bundle` · `capability-disable-while-attached`（global 活闸）。这些一条不能红。

---

## A. 解析真值表（domain 单测，穷尽 6 行）

被测纯函数 `domain.ResolveACL(roleGranted, overrides) → frozenAllow`。每个 target 输入 `role ∈ {Y,N}` × `code ∈ {unset,allow,deny}` = **6 行全测**：

| # | role | code | frozen | 语义 |
|---|---|---|---|---|
| A1 | Y | unset | **allow** | 继承 role 授权 |
| A2 | Y | allow | **allow** | 冗余 allow（幂等） |
| A3 | Y | deny | **deny** | **code 撤销 role 授的** |
| A4 | N | unset | **deny** | 继承 role 未授 |
| A5 | N | allow | **allow** | **code 加上 role 没有的** |
| A6 | N | deny | **deny** | 冗余 deny（幂等） |

外加 `code_override_resolution_deterministic`：同输入跑 3 次结果一致（防 map iter 抖动，对齐 system_prompt_hash 不变量）。

---

## B. Happy-flow 组合矩阵（e2e）

完整暴露式：`exposed = global_on ∧ frozenAllow ∧ connector_deps ∧ quota`。本节固定 connector 已连、quota 充足，只动 global × frozen，**且 capability 与 skill 两类 target 各跑关键行**。

### B.1 global=ON，扫 6 个 frozen 行 × 2 target

| spec | target | role | code override | 期望 |
|---|---|---|---|---|
| `acl-cap-inherit` | calendar.book | 授 | 无 | 暴露（A1，回归基线） |
| `acl-cap-code-revokes` | calendar.book | 授 | deny | **不暴露**（A3） |
| `acl-cap-code-adds` | calendar.book | **不授** | allow | **暴露**（A5） |
| `acl-cap-code-allow-redundant` | calendar.book | 授 | allow | 暴露（A2） |
| `acl-cap-none` | calendar.book | 不授 | 无 | 不暴露（A4，回归） |
| `acl-cap-code-deny-redundant` | calendar.book | 不授 | deny | 不暴露（A6） |
| `acl-skill-code-revokes` | skill X | 授 | deny | **skill X 的 skill_use 不暴露**（A3·skill） |
| `acl-skill-code-adds` | skill Y | 不授 | allow | **skill Y 暴露**（A5·skill） |

判据：`sessionToolNames(code 的 session)` 含 / 不含目标 tool（`calendar_book` / 该 skill 的暴露形态）。

### B.2 global 是顶层 master

| spec | 场景 | 期望 |
|---|---|---|
| `acl-global-beats-code-allow` | global 关 calendar.book + role 授 + code allow | **不暴露**（global 纯 deny master，盖过下面全部，A.3） |
| `acl-global-on-frozen-decides` | global 开 + role 授 + code deny | 不暴露（global 开时由 frozen 定，验 master 只减不增） |

---

## C. 冻结 vs 活（语义不对称，两边都要锁）

| spec | 层 | 操作时序 | 期望 | 锁的不变量 |
|---|---|---|---|---|
| `acl-code-frozen-at-issue` | code | issue → 改 code override → 同 session 下一 turn | **不变**（仍按 issue 时的） | role/code 冻结 |
| `acl-code-reissue-reflects` | code | 改 code override → **新** issue | 新 session 生效 | 改 code 只影响后续 |
| `acl-global-live-mid-session` | global | issue → 关 global → 同 session | **立刻消失** | global 活（= 现有 `capability-disable-while-attached` 的同族，引用即可） |

> 这三条是本设计最容易写错的地方：code 改了**在跑的不动**，global 改了**在跑的立刻动**。

---

## D. 隔离（per-code，不是 per-role）

| spec | 场景 | 期望 |
|---|---|---|
| `acl-code-isolation` | 同 role 两个 code：code-1 deny X，code-2 无 override | code-1 session 无 X；**code-2 session 有 X** |
| `acl-code-override-scoped-to-owner` | 拿别的 owner 的 codeId 写 override | 404/403，互不串 |

---

## E. 错误流

| spec | 输入 | 期望 |
|---|---|---|
| `acl-override-bad-state` | PATCH override `state="maybe"` | 400，不写 |
| `acl-override-unknown-capid` | override 一个不存在的 capability id | 写入不报错、解析时无匹配 → 零效果、不崩（id 永不命中已注册 cap） |
| `acl-override-on-revoked-code` | code 已 revoke + 带 override | session 401（现有），override 无意义 |
| `acl-override-missing-csrf` | 无 CSRF 头 PATCH | 403（沿用 admin 鉴权，不另写逻辑） |

---

## F. Corner cases（正交闸的交叉 —— 重点）

每条都是"code-override 与另一道闸相遇时谁说了算"。**code-override 只管授权（grant），不越权去碰存在性 / 连接 / 配额。**

| # | spec | 场景 | 期望 | 为什么 |
|---|---|---|---|---|
| F1 | `acl-code-allow-cannot-resurrect-disabled-skill` | skill 全局 `skill.Enabled=false` + code allow 它 | **仍不暴露** | code 管授权，不管 skill 的存在/可用（owner 的 `skill.Enabled` 是另一道、更高的闸）。防 code-override 变第二个 skill enable。 |
| F2 | `acl-code-allow-still-needs-connector` | role 不授 calendar.book + code allow + **GCal 未连** | **仍不暴露** | connector_deps_met 独立闸；frozen 说 allow 不等于依赖满足。 |
| F3 | `acl-global-deny-beats-code-allow` | global 关 + code allow | 不暴露 | = B.2，再从 corner 角度锁一次 master 优先。 |
| F4 | `acl-code-deny-noop-when-role-ungranted` | role 不授 + code deny | 不暴露（无变化） | 幂等，A6 的 e2e 版。 |
| F5 | `acl-code-override-owner-only-noop` | code allow 一个 owner-only 能力（如 seo） | visitor session 无变化、不崩 | owner-only 不在访客平面（Phase H shape 过滤）；override 对它无意义但不能炸。 |
| F6 | `acl-code-allow-still-respects-quota` | role 授 + code allow + code MaxBookings 耗尽 | 不暴露 | quota 独立闸。 |
| F7 | `acl-code-allow-idempotent-with-role` | role 授 + code allow 同一能力 | 暴露、且工具集无重复 | 合并是集合并，不双发。 |
| F8 | `acl-public-session-no-override-layer` | public/byoai（无 code） | 行为 = owner vanilla role，override 层不参与 | 无 code → 无 override 来源（回归保护）。 |

---

## G. 红先行实施顺序

1. **§A domain 单测**（6 行真值表 + determinism）→ 红 → 实现 `ResolveACL` → 绿。锚定真值。
2. **§B happy 矩阵** → 红 → 实现 schema + repo + `applyCodeOverrides` 接进 `buildRoleSnapshotForCode` + admin override 写口 → 绿。
3. **§C 冻结/活 + §D 隔离** → 红 → （多半 2 实现完就绿；补 isolation 的两 code 种子）。
4. **§F corner** → 逐条红→绿；F1/F5 可能暴露"正交闸顺序"细节，按需调。
5. **§E 错误流** → 红→绿。
6. **回归锚（§0）** 全程保持绿；每实现一步重跑一次。

**完成定义：** §A–§F 全绿 + §0 回归锚一条不红 + `make lint` 绿（含 docker golangci）。

---

## H. 覆盖自检（防漏）

- [ ] 真值表 6 行全测（A1–A6），不只测"能加能减"两个亮点。
- [ ] capability 和 skill 两类 target 都跑过"撤销"和"新增"。
- [ ] 冻结（code）与活（global）两种时序都锁。
- [ ] 三道正交闸（connector / quota / skill.Enabled）各跟 code-allow 交叉过一次。
- [ ] master（global）只减不增锁过。
- [ ] per-code 隔离锁过（同 role 两 code 分叉）。
- [ ] public/byoai 无 code 路径回归过。
- [ ] 错误流 4 条（坏值 / 未知 id / revoked / 无 CSRF）。
