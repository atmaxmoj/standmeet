# 理论基础：Coalgebraic Behavioral Distillation

## Abstract

StandMeet 的蒸馏系统不只是一个工程管道——它在做一个数学问题：**从有限行为观察中构造一个能在未见情境中复现用户行为的模型**。Coalgebra 是这个问题的自然数学语言。

本文建立蒸馏系统的理论框架，目的不是形式化验证，而是：
1. 给工程设计提供精确的概念工具（什么叫"蒸馏成功"？）
2. 用理论指导 harness 设计（观测什么、怎么观测、怎么知道观测够不够）
3. 暴露工程直觉容易忽略的结构性限制

---

## 一、用户作为 Coalgebra

### 基本模型

用户是一个有状态的行为系统。给定一个情境（输入），产出一个行动（输出），同时内部状态转移。这是一个 Mealy machine coalgebra：

```
用户-coalgebra  α: S → (O × S)^I

S = 用户内部状态空间（不可观测，可能无限维）
    包括：知识、情绪、疲劳度、最近经历、长期偏好...
I = 情境空间（收到邮件、遇到 bug、被问问题、技术选型...）
O = 行动空间（回复、忽略、转发、先查再回、写测试...）

α(s)(i) = (o, s')
在状态 s 下遇到情境 i → 执行行动 o，转移到状态 s'
```

关键：S 不可直接观测。我们只能看到 (i, o) 对的序列——用户-coalgebra 的 **trace**。

### 为什么是 coalgebra 不是 algebra

```
Algebra  = 构造视角：怎么把零件组装成系统     F(A) → A
Coalgebra = 观察视角：怎么从外部理解系统行为   A → F(A)
```

我们不拆开用户的大脑——我们通过观察行为来建模。这恰好是 coalgebra 的立场，也是 Ashby 的立场："cybernetics treats not things but ways of behaving"。

---

## 二、Bisimulation 作为成功标准

### 定义

蒸馏的目标是构造一个 agent-coalgebra：

```
agent-coalgebra  β: T → (O × T)^I

T = agent 的状态空间 = (Playbook, Identity, Episodes, CurrentContext)
```

使得 β 和 α **bisimilar**：

```
R ⊆ S × T 是 bisimulation 关系，当且仅当：
  对所有 (s, t) ∈ R，对所有情境 i ∈ I：
    若 α(s)(i) = (o, s') 且 β(t)(i) = (o', t')
    则 o = o' 且 (s', t') ∈ R
```

直觉：在 R 关联的状态对上，用户和 agent 在任何情境下做同样的事，且行动后的后继状态仍然关联。

### 为什么是 bisimulation 不是 trace equivalence

Trace equivalence（轨迹等价）只要求历史行为序列相同。Bisimulation 更强——它要求在**所有未来分支**上行为都相同。

```
Trace equivalence：过去像 → 但未来不一定像
Bisimulation：过去像 + 未来也像

蒸馏要的是后者——不是"回放"用户的历史，是在新情境中"像用户一样做"。
```

### 有限近似

完全的 bisimulation 不可实现（S 不可观测、I 可能无限）。实际上我们追求的是：

```
ε-bisimulation on I' ⊆ I

在已观察的情境子集 I' 上，agent 的行为和用户的行为偏差 ≤ ε
```

技能成熟度是这个近似的度量：

```
nascent:    |I'| 太小，bisimulation 无法有意义地建立
developing: I' 上 bisimulation 部分成立（ε 较大）
mature:     I' 上 bisimulation 基本成立（ε 小）
mastered:   I' 包含边界情境和反例，bisimulation 仍成立
```

Ashby 覆盖率 = |I'_verified| / |I_observed|，是 bisimulation 已验证域占已观察域的比例。

---

## 三、Harness 与函子

### Harness 定义函子

Harness = 观测框架（Screenpipe + 信号过滤 + 本地工具 + episode 边界检测）。

Harness 的设计选择定义了函子 F：

```
F 决定了：
  什么是一个"观察"（屏幕文本？git commit？鼠标轨迹？）
  什么粒度（秒？任务？天？）
  什么算一个"情境"（任务边界怎么切？什么上下文纳入？）
  什么算一个"行动"（一次 commit？一段输入？一个选择？）
```

不同的 harness → 不同的 F → 不同的 bisimulation 概念。

### F 决定 bisimulation 的上限

```
定理（非正式）：
  Harness H 能支持的最细 bisimulation 不可能比 F_H 的分辨率更细。
  如果两个行为在 F_H 下不可区分，无论积累多少数据，它们永远 bisimilar。
```

例：

```
没有 git_log 的 harness：
  F₁ 下，"写新功能 1 小时" 和 "重构 1 小时" 是 bisimilar
  → Screenpipe 只看到 VS Code 在打字

加了 git_log 的 harness：
  F₂ 下，它们不再 bisimilar
  → git log 区分 feat commit 和 refactor commit
```

加工具不是"加数据"，是改变 F，改变什么行为是可区分的。

### 自动发现本地工具 = 自动选择最丰富的可用 F

```
工程师的 F = F_screenpipe × F_git × F_shell × F_docker
律师的 F   = F_screenpipe × F_browser × F_calendar
设计师的 F = F_screenpipe × F_figma × F_file_changes

不同的 F → 不同的 induced bisimulation → 不同的 Playbook 结构
```

这解释了为什么 Playbook 由系统涌现、不预设——F 因人而异，F 决定了什么行为模式是可区分的，可区分的模式才能成为 Playbook 条目。

### 信号过滤 = 函子的商

信号过滤层（丢掉鼠标移动、页面滚动、< 3 秒的 app 切换）是有意地对 F 取商：

```
F_raw = Screenpipe 原始输出
F_filtered = F_raw / ~    （对噪音行为取等价类）
```

Tradeoff：F 越粗 → bisimulation 越容易建立但越不精确。F 越细 → 越精确但需要更多数据。

多层蒸馏管线在不同粗细的 F 上工作：

```
秒级：  F 最细（击键级别）→ 微操特征
任务级：F 中等（任务边界）→ 方法论
天级：  F 较粗（天级聚合）→ 决策风格
周级：  F 最粗（周级聚合）→ 底层模式

每一层是上一层的商函子。每一层的 bisimulation 比上一层更粗但更稳定。
```

---

## 四、对偶结构：蒸馏与执行

### Bisimulation-targeted design（蒸馏层）

Bisimulation 是目标。这个目标驱动 harness 的设计：

```
"为了达到和用户的行为互模拟，
 我应该观测什么？怎么切 episode？Playbook 怎么组织？"

α (用户) → 观察 → 构建 β 使得 β ~bisim~ α
               ↑
               bisimulation 作为目标函数
               决定 F 的选择（观测什么、什么粒度）
               决定 Playbook 的结构（情境怎么切、行动怎么编码）
```

### Harness-induced bisimulation（执行层）

执行时，harness 约束 agent 的行为，induce 出一个具体的 bisimulation：

```
β (agent) → harness 约束 → 行为输出
              ↑
              Playbook 定义了合法的 (情境→行动) 映射
              Identity 定义了行动空间的边界
              confidence 门槛定义了 bisimulation 的有效域
              → harness 将 agent 行为限制在 bisimulation 关系内
```

Harness 不是"希望 agent 像用户"，是**强制 agent 在 Playbook 覆盖的域内和用户行为一致**。Induced bisimulation 在覆盖域内是保证的，不是验证的。

### 两面的收敛

系统的质量 = 这两面是否收敛：

```
蒸馏层瞄准的 bisimulation（"我想让 agent 在这些情境下像用户"）
  ≈
执行层 harness 实际 induce 的 bisimulation（"agent 实际在这些情境下像用户"）

差距来自：
  1. F 分辨率不够 → 蒸馏层瞄准的比 harness 能 induce 的更细
  2. 数据不够 → bisimulation 在有限 trace 上成立但未泛化
  3. 非定常 → 用户变了，harness induce 的还是旧的 bisimulation
```

### 覆盖域内 vs 覆盖域外

```
harness 覆盖域内：bisimulation 是 induced（保证的）
  Playbook 有条目 + confidence ≥ 0.8 → agent 按 Playbook 行动
  行为等价性由 harness 结构保证

harness 覆盖域外：bisimulation 是 conjectured（猜的）
  Playbook 没覆盖 → 靠 Identity 推理 + Episodes 检索
  行为等价性是 LLM 的泛化能力在支撑，没有结构保证

mature Playbook = induced bisimulation 的定义域大
nascent Playbook = induced bisimulation 的定义域小，大部分靠 conjecture
```

---

## 五、Bisimulation-driven Harness Design

Bisimulation 的质量是可观测的。每次 agent 行为和用户行为不一致就是一次 bisimulation failure。这些 failure 是诊断信号，指向 harness 的具体改进方向。

### Bisimulation failure 的分类

#### 推导

Bisimulation failure = 在某个情境 i 上，α(s)(i) 产出 o，β(t)(i) 产出 o'，o ≠ o'。

成立条件依赖四个组件：F（函子/观测框架）、I（情境空间划分）、β（agent-coalgebra/学到的模型）、α（用户-coalgebra/用户本身）。

如果 F 足够细、I 划分正确、β 已从足够数据中收敛、α 没变，bisimulation 必然成立。所以 failure 必然来自其中至少一个组件。四个组件 → 四类 failure，且穷举：

```
组件    failure 含义                              工程语言
────────────────────────────────────────────────────────────
F       有行为差异但观测框架看不到区分信号          隐变量不在观测范围内
I       观测框架看到了信号但情境编码没用上          Playbook 条目该拆没拆
β       F 和 I 都够，模型还没从足够数据中收敛      样本不够
α       F、I、β 都对，但用户本身变了               环境/习惯/工具变了
```

互斥性：不完全互斥，现实中可能同时有多个组件出问题。但诊断有优先级——先排除 α 变了（看 confidence 时序趋势），再排除 β 未收敛（看样本量），最后区分 F 和 I（看条目内方差模式）。

---

**Type 1：F 不够（函子分辨率不够）**

```
信号：同一个 Playbook 情境，用户有时做 A 有时做 B
      agent 无法预测哪次是 A 哪次是 B
诊断：存在隐状态变量没被 F 捕获
      用户的行为依赖于某个 F 看不到的维度

例：
  情境"收到客户邮件"，用户有时秒回有时拖一天
  F_screenpipe 看不到原因
  加入 F_calendar 后发现：当天有 deadline 时拖，空闲时秒回
  → 隐变量是"当天日程压力"

harness 改进：
  加观测工具（扩展 F）→ F' = F × F_new
  或细化情境编码 → 把隐变量显式编码进情境空间 I
```

**Type 2：I 太粗（情境空间切分不够）**

```
信号：一个 Playbook 条目观察了很多次但 confidence 上不去
      条目内部的行为方差很大
诊断：这个条目覆盖了应该被区分的多种情境
      I 的划分太粗，多个不同情境被合并成一个了

例：
  "debugging" 条目，confidence 卡在 0.6
  进一步分析：前端 bug 和后端 bug 的处理方式完全不同
  → "debugging" 应该分成 "frontend-debugging" 和 "backend-debugging"

harness 改进：
  增加情境维度 → I' = I × D（D 是新的区分维度）
  Playbook 条目拆分
```

**Type 3：β 未收敛（数据不足）**

```
信号：情境只出现过 1-2 次
      confidence 低但不矛盾（不是方差大，是样本少）
诊断：样本不够，harness 本身没问题

harness 改进：
  等待自然积累
  或主动提问加速（"你在这种情况下通常怎么做？"）
  → 这是 Angluin L* 的 membership query
```

**Type 4：α 变了（非定常）**

```
信号：bisimulation 曾经成立，现在开始失败
      Playbook 条目的 confidence 下降
      用户的行为和 Playbook 记录的偏差越来越大
诊断：用户变了——换工具、换角色、换习惯
      底层 coalgebra 的函子 F 或转移函数 α 变了

例：
  用户从 Google Calendar 换到 Notion Calendar
  meeting-prep.md 的所有条目突然不 work 了
  不是数据问题，是系统结构变了

harness 改进：
  检测到漂移 → 旧条目降权或归档
  重新观察 → 在新 F 下重建 bisimulation
```

### 诊断流程

```
Bisimulation failure detected（agent 行为 ≠ 用户行为）
  │
  ├── 这个情境在 Playbook 里有条目吗？
  │     │
  │     ├── 没有 → Type 3（数据不足）→ 等待或主动提问
  │     │
  │     └── 有 → 这个条目的 confidence 趋势？
  │           │
  │           ├── 一直低（从没高过）→ 条目内方差大吗？
  │           │     │
  │           │     ├── 大 → Type 2（切分不够）→ 拆分条目，增加情境维度
  │           │     └── 不大但不稳定 → Type 1（F 太粗）→ 找隐变量，扩展 F
  │           │
  │           └── 曾经高现在降 → Type 4（非定常）→ 检测变化，重建
  │
  └── 诊断结果写入 meta/gaps.jsonl
      → 周级 Opus 在分析时看到诊断信息
      → 自然地做出 harness 改进（拆分条目 / 加情境维度 / 归档旧条目）
```

### 闭环：Bisimulation 驱动 harness 演化

```
观察用户行为
  → 构建 Playbook（bisimulation-targeted design）
    → agent 按 Playbook 执行（harness-induced bisimulation）
      → 执行结果 vs 用户行为对比
        → bisimulation failure 分类诊断
          → harness 改进（扩展 F / 细化 I / 重建条目）
            → 回到观察
```

这个闭环本身就是一个控制论系统：
- 被控对象 = harness 的设计
- 传感器 = bisimulation failure 检测
- 控制器 = failure 诊断 + 改进策略
- 执行器 = Playbook 更新 / 工具注册 / 情境重新编码

Ashby 的必要多样性在这里也生效：**诊断策略的多样性必须 ≥ failure 类型的多样性**。四种 failure type，四种改进策略——刚好满足。

---

## 六、结构性限制

### 不可达行为

当行为差异来自不可观测的内部状态时，bisimulation 原则上不可达：

```
用户昨天和伴侣吵架了 → 今天对客户邮件的语气明显不同
这个状态变量不在任何 F 的观测范围内
Playbook 会看到"同一种邮件，有时友好有时冷淡"
→ confidence 永远上不去
→ 不是 harness 不够好，是理论上不可达
```

meta/confidence.json 的理论依据：有些低 confidence 不是"还没学够"，而是"原则上学不到"。系统应该能区分这两种情况（Type 3 vs Type 1 中不可扩展的情况）。

### Stateless 近似 Stateful 的根本张力

```
用户-coalgebra 是有状态的：S → (O × S)^I
Playbook 本质上是 stateless 的：I → O

Playbook 用情境空间 I 的细分来近似状态空间 S 的区分：
  α(s_pressure)(bug) = skip_test     →  playbook(bug_urgent) = skip_test
  α(s_normal)(bug)   = write_test    →  playbook(bug_normal) = write_test

把 s 编码进 i。在很多情况下足够，但有根本限制：
  当行为差异纯粹来自内部状态、没有外部可观测信号时，
  无论怎么细分 I 都无法区分。
```

Identity 和 Episodes 存在的理论依据：它们为 Playbook 的 stateless 映射补充了 stateful 的近似——Identity 是长期稳定的状态摘要，Episodes 是短期状态的向量检索。三者合起来近似一个 stateful coalgebra。

### 非定常系统的根本限制

```
标准 coalgebra S → F(S) 假设 F 固定。
用户的 F 随时间变化：F_2025 ≠ F_2026

在 F_old 上学的 bisimulation 应用到 F_new 上可能失效。
检测失效需要新的 trace——但如果 agent 在自动执行，用户不亲自做了，
就没有新的 trace 来检测 F 是否变了。
→ bisimulation 静默失效（二阶控制论的"执行漂移"）

主动扰动（定期降回建议模式）= 主动生成新 trace 来验证 bisimulation 是否仍成立。
这不是工程 hack，是理论要求。
```

---

## 七、与蒸馏系统设计的对应

| 理论概念 | 工程对应 | 设计启示 |
|---------|---------|---------|
| 用户-coalgebra α | 用户的真实行为 | 不可直接观测，只能看 trace |
| Agent-coalgebra β | Playbook + Identity + Episodes | 有限状态的近似 |
| 函子 F | Harness（观测框架） | 决定 bisimulation 的上限 |
| F 的商 | 信号过滤层 | 有意地做粗以降低噪音 |
| Bisimulation | 行为等价 | 成功标准，不是 confidence 高 |
| ε-bisimulation on I' | 技能成熟度 | mature = 大域上小 ε |
| Bisimulation failure | agent 行为 ≠ 用户行为 | 四类诊断信号 |
| Type 1 failure | F 太粗 | 加观测工具 |
| Type 2 failure | I 切分不够 | 拆分 Playbook 条目 |
| Type 3 failure | 数据不足 | 等待或主动提问 |
| Type 4 failure | 函子漂移 | 归档旧条目，重新观察 |
| Coinduction | 渐进验证 | 不需要穷举，逐步扩展 |
| Coalgebraic minimization | Playbook 去重 | 行为等价的条目应合并 |
| Final coalgebra | 所有可能行为的"宇宙" | Playbook 是有限近似 |
| Stateless ≈ stateful | Playbook + Identity + Episodes | 三者合起来近似 stateful |
| 非定常 | 用户变化 | staleness + 主动扰动 |
| L* membership query | 主动提问 | 在 bisimulation 不确定处提问 |
| L* counterexample | DAgger（agent 做错了） | 用 failure 来改进模型 |

---

## 八、与 Cybernetics 的关系

Coalgebra 和 cybernetics 在"系统由外部行为定义"这个核心立场上是同一件事的两种表述——前者给出精确数学结构，后者给出工程直觉和设计原则。

**已确立的对应：**

- Ashby 的"系统由行为定义，不由结构定义" ↔ coalgebraic bisimulation。Bisimulation 正是"内部不同但行为相同"的精确形式化。
- Rutten 的 "Universal coalgebra: a theory of systems" 明确把 coalgebra 定位为系统理论。

**StandMeet 中的交汇：**

| Cybernetics | Coalgebra | StandMeet |
|------------|-----------|-----------|
| 黑箱观察 | A → F(A) | 从行为推断模式 |
| 必要多样性 | F 的分辨率上限 | harness 的观测能力 |
| 反馈控制 | bisimulation failure → 修正 | DAgger + 主动提问 |
| 执行漂移 | 非定常 coalgebra | staleness + 主动扰动 |
| 观察改变行为 | 尚无严格形式化 | 用户知道系统在学习 |

**尚未严格形式化（开放问题）：**

- 二阶控制论（观察者作为系统一部分）↔ coalgebra of coalgebras？需要更多工作。
- 自创生 ↔ final coalgebra？有论文探索但非共识。
- 必要多样性定律 ↔ 范畴论约束？Ashby 定律的严格表述走信息论（channel capacity），和 coalgebra 的直接桥梁不明确。
