# 行为蒸馏系统设计

## Abstract

从 OS 级行为监控到 agent 可用的人格模型。核心类比：**系统是一个学徒，通过观察师傅的行为来学习师傅是谁**。好学徒不是记录一切，而是知道看什么、怎么看、什么时候承认自己不懂。

记忆的目的不是描述师傅，是**在新场景中像师傅一样做**。

---

## 设计原则：好学徒怎么学

| 好学徒会… | 差学徒会… | 系统对应 |
|-----------|----------|---------|
| 看完整件事再总结 | 老师做一步就记一步 | 按任务边界切 chunk，不按固定时间 |
| 注意老师没做什么 | 只记老师做了什么 | 回避模式检测 |
| 观察压力下的变化 | 只看常态表现 | 压力状态标记 |
| 跨场景归纳"为什么" | 只记录"是什么" | 向量搜索 + 跨领域联想 |
| 模仿后对比差异 | 只观察不实践 | 主动学习回路 |
| 不确定时说"我不知道" | 瞎编答案 | confidence 门槛 + 未答问题反馈 |

### 理论基础

| 学科 | 核心洞察 | 对应设计 |
|------|---------|---------|
| 认知任务分析 / RPD（Klein） | 专家靠情境-行动的模式匹配决策，不是决策树 | Playbook 用情境-行动对，不是 if-else |
| 行为克隆 / DAgger | 边界纠正数据价值最高 | 主动学习时故意让 agent 在不确定场景回答 |
| 隐性知识（Polanyi） | 大部分能力"说不出来" | 原始摘要池是隐性知识的唯一容器 |
| 情境学习（Lave & Wenger） | 同一能力在不同情境下表现不同 | 所有 playbook 条目必须带情境标签 |
| 遗忘曲线（Ebbinghaus） | 遗忘是功能，每次回忆强化记忆 | 记忆固化：被检索的保留，未检索的衰减 |
| 必要多样性定律（Ashby） | 控制器的多样性必须 ≥ 被控系统的多样性 | Playbook 覆盖率指标：情境覆盖 / 实际情境种类 |
| 二阶控制论（von Foerster） | 观察者改变被观察系统；控制器也会漂移 | 全自动条目定期强制降回建议模式，防止执行漂移 |
| 正反馈放大（Wiener） | 不只纠偏（负反馈），也要放大好的变化 | 检测到效率提升时，识别并固化新模式 |

---

## 整体架构

```
┌──────────────────────────────────────────────────────────┐
│  采集层                                                    │
│                                                            │
│  Screenpipe（广度采样，MIT 协议）                            │
│  屏幕 accessibility tree / OCR / 音频 Whisper               │
│  事件驱动捕获，5-10% CPU                                    │
│                                                            │
│  本地工具日志（深度精确，按需查询）                            │
│  git log / shell history / browser history /                │
│  file timestamps / docker logs / app usage                  │
└──────────────────┬───────────────────────────────────────┘
                   │ 原始事件流 ~100MB/天
                   ▼
┌──────────────────────────────────────────────────────────┐
│  信号过滤层                                                │
│  ├── 转折点检测：修正 / 选择 / 顺序 / 停顿 / 放弃          │
│  ├── 回避模式检测：可用但未使用的工具和路径                   │
│  ├── 压力状态标记：频率突变、跳过常规步骤                     │
│  └── 任务边界检测：识别完整任务的开始和结束                   │
│  过滤掉 90% 噪音                                          │
└──────────────────┬───────────────────────────────────────┘
                   │ 高信号事件 ~5MB/天
                   ▼
┌──────────────────────────────────────────────────────────┐
│  多层蒸馏管线                                               │
│                                                            │
│  秒级 ──规则──→ 微操特征库                                   │
│  任务级 ─Haiku─→ 方法论库（按任务边界切）                     │
│  小时级 ─统计──→ 节奏模式库                                   │
│  天级 ──Sonnet─→ 决策风格库（agent loop）                    │
│  周级 ──Opus──→ Playbook + Identity（agent loop）            │
│        │                                                    │
│        ├── Playbook 感知（启动时注入索引，agent 自主读写）     │
│        ├── 下钻验证（索引链 → Screenpipe → 本地工具）         │
│        └── 联想发现（find_similar 跨领域搜索）                │
└──────────────────┬───────────────────────────────────────┘
                   │
       ┌───────────┼───────────┐
       ▼           ▼           ▼
   Playbook    Episodes     Meta
  （复现用）  （向量DB）   （自知）
       │           │           │
       └───────────┼───────────┘
                   ▼
┌──────────────────────────────────────────────────────────┐
│  StandMeet Agent                                          │
│  ├── 复现行为：查 Playbook 的情境-行动对                     │
│  ├── 价值观兜底：查 Identity 推理未见场景                     │
│  ├── 临场应答：向量 DB retrieve 原始摘要                     │
│  ├── confidence 门槛：不确定就说不知道                       │
│  └── 主动学习回路：agent 草稿 vs 用户实际回复                 │
└──────────────────────────────────────────────────────────┘
```

---

## 一、采集层：广度采样 + 深度精确

### 1.1 Screenpipe（广度采样层）

什么都看一眼，事件驱动，CPU 5-10%。

```
捕获：屏幕文本（accessibility tree / OCR fallback）、音频转录（Whisper）
频率：有事件时捕获，空闲时低频兜底
输出：时间戳 + app 名 + 窗口标题 + 文本内容
局限：采样，高频行为会有缝隙
```

### 1.2 本地工具日志（深度精确层）

Screenpipe 有缝隙时，高阶 model 按需查询本地工具的原生日志。**这些日志已经在本地了，零存储成本，只在需要时才访问。**

工具不预设——系统根据用户的工作环境**自动发现**可用的日志源：

```
自动发现逻辑：
  检测 ~/.gitconfig 存在？       → 注册 git_log(repo, since, until)
  检测 ~/.zsh_history 存在？     → 注册 shell_history(since, until)
  检测 ~/Library/Safari/ 存在？  → 注册 browser_history(since, until)
  检测 Figma 本地缓存？         → 注册 figma_history(since, until)
  检测 Outlook/Calendar DB？     → 注册 calendar_events(since, until)
  检测 Notion 本地缓存？         → 注册 notion_changes(since, until)
  ...

通用工具（所有用户都有）：
  file_changes(directory, since, until)  → 文件修改记录（来自 fs 时间戳）
  app_usage(since, until)                → 应用使用时长（macOS 原生 API）
  clipboard_history(since, until)        → 剪贴板历史（如果启用）

本质：不是"给工程师配 git log"，是"看用户装了什么，就把什么的日志接进来"。
```

### 1.3 两层配合

```
场景 A（工程师）：Opus 下钻验证"他在 10:32-10:35 做了什么"
  Screenpipe："10:32 VS Code commit 1857" → "10:35 commit 1845"（中间 12 个漏了）
  → git_log 补全 → 8 个 refactor + 3 个 test → "重构冲刺"

场景 B（律师）：Opus 下钻验证"她在 14:00-14:30 看了什么"
  Screenpipe："14:00 打开 Westlaw" → "14:30 打开 Word 开始写"（中间查了什么？）
  → browser_history 补全 → 5 个判例页面 + 2 个法条页面 → "她先查判例再查法条"

场景 C（设计师）：Opus 下钻验证"他在 16:00-16:20 改了什么"
  Screenpipe："16:00 Figma 打开" → "16:20 导出 PNG"（中间改了多少版？）
  → file_changes 补全 → 7 次 autosave → "反复调整间距和颜色"
```

原则：**不要预先把所有工具日志灌进数据库。给 agent 工具访问权限，让它需要时自己去拿。**（Peter 的语音 moment 同理）

---

## 二、信号过滤层

### 2.1 转折点检测（做了什么）

| 转折点 | 暴露什么 | 捕获方式 | 信号强度 |
|-------|---------|---------|---------|
| **修正**：写了→删掉→重写 | 质量标准 | 输入框 diff | ★★★★★ |
| **选择**：多个选项→选了一个 | 偏好排序 | 搜索 query + 点击 | ★★★★ |
| **顺序**：做事的先后路径 | 方法论 | app 切换序列 + 时间戳 | ★★★★ |
| **停顿**：长时间无操作→突然大动作 | 思考深度 | 事件间隔分析 | ★★★ |
| **放弃**：开始→中途放弃→换方向 | 判断力 | 短开即关的文件、被删的大段输入 | ★★★ |

### 2.2 回避模式检测（没做什么）

"从不"比"总是"更暴露本质。

```
检测"可用但未使用"的模式：
  工程师：装了 Docker 但总用 native 环境；有 Copilot 但经常 dismiss
  律师：有 Westlaw 但总先去 Google Scholar；判例库会员但从不用高级搜索
  设计师：装了 Figma 插件但全手动画；有 Design System 但总自己画组件
  市场：有自动化工具但总手动发邮件；团队用 CRM 但他只看 Excel 导出
  通用：开了 Slack 但从不主动发消息，只回复（所有职业都可能出现）
```

实现：维护一个"已知可用工具/功能"清单，定期统计使用频率。使用频率接近零的 → 标记为回避行为。

### 2.3 压力状态标记

压力下丢掉的习惯 = 后天学的。压力下保留的习惯 = 内化的。

```
压力信号检测：
  - 同一时段 保存/提交/发送 频率突然翻倍
  - app 切换频率突然上升（焦虑信号）
  - 开始跳过平时会做的步骤
  - 连续工作时间显著延长（凌晨还在干，但平时不会）

蒸馏影响：
  常态行为 → Playbook 的主要来源
  压力下的行为 → 单独标记，区分"真性格"vs"后天纪律"

例子：
  工程师：常态跑测试，压力下跳过 → 测试是后天纪律
  律师：常态每份合同查三遍判例，deadline 前只查一遍 → 尽调深度是纪律
  设计师：常态做 3 版方案给客户选，急稿只做 1 版 → 多方案策略是纪律
  通用推断：压力下丢掉的 = 后天学的；压力下保留的 = 内化的
```

### 2.4 任务边界检测

好学徒看完整件事再总结，不是做一步记一步。

```
边界信号：
  - 上下文大切换（从项目 A 切到项目 B → 新任务）
  - git commit（通常标志一个原子任务完成）
  - 长停顿后换了工作方向
  - 关闭了一批 tab/文件，打开另一批

实现：
  主切分仍按时间（30 分钟兜底）
  但如果检测到任务边界，在边界处切
  如果一个任务跨了 2 小时也没中断，就让它成为一个长 chunk
```

### 2.5 低信号行为（直接丢弃）

常规打字速度、页面滚动、鼠标移动轨迹、系统通知弹窗、app 之间 < 3 秒的来回切。

---

## 三、多层蒸馏管线

### 秒级（微操层）

```
观察：击键、删改、自动补全后的调整、格式修正
蒸馏物：工作风格、命名/措辞偏好、工具熟练度
方法：纯规则提取（正则 + diff），$0
例子：
  工程师："他总是把 AI 补全的 data 改成语义化命名"
  律师："他总是把'应当'改成'须'"
  设计师："他总是把自动对齐的间距手动调成 8 的倍数"
  通用："他在 email 里从不用感叹号" ← 回避模式
```

### 任务级（方法论层）

```
观察：一个完整任务的执行过程（由任务边界检测器切分）
蒸馏物：问题解决方法论、信息搜集策略
方法：Haiku 做序列摘要，~50 次/天 ≈ $0.05/天
例子：
  工程师："遇到报错 → Google → Stack Overflow → 不满意 → 读源码"
  律师："接到案子 → 先读合同全文 → 标红不利条款 → 查判例 → 再读一遍"
  市场："看到数据下降 → 先看竞品 → 再看渠道 → 最后看内容"
  压力下："跳过中间步骤直接问 ChatGPT" ← 压力标记
```

### 小时级（节奏层）

```
观察：半天的工作流
蒸馏物：注意力模式、精力分配、上下文切换频率
方法：统计分析为主，$0
例子："上午 9-12 点几乎不切 app（深度工作时段）"
```

### 天级（决策层）

```
观察：一整天的行为（所有任务级摘要 + 节奏统计 + 压力标记）
蒸馏物：优先级判断、时间管理、压力应对
方法：Sonnet 做日报分析，1 次/天 ≈ $0.03/天
例子："紧急需求来了，花 20 分钟收尾手头的事再切过去"
```

### 周级（人格层）

```
观察：7 个日报摘要 + 微操特征统计 + 回避模式汇总
蒸馏物：Playbook 条目、价值观、性格特征
方法：Opus 做周报分析，1 次/周 ≈ $0.02/天
工具：
  - read_summary(date) → 读某天的日报
  - drill_down(chunk_id) → 下钻到任务级/秒级
  - find_similar(behavior, time_range?) → 向量搜索相似行为
  - git_log / shell_history / browser_history → 本地工具精确查询
```

### 天级和周级：不是单次 LLM 调用，是 Agent Loop

秒级和任务级可以单次调用搞定——输入明确、输出确定。但天级和周级是**探索性分析**：不知道今天的重点是什么，需要先扫一遍、形成假设、再深挖验证。单次 prompt 塞不下一天的所有 episode（可能几十上百个），塞下了注意力也会稀释。

这和 OpenClaw 的 agent loop 是同一个 insight：**复杂任务需要 LLM → tool_use → execute → result → LLM → ... 的多轮循环**，不是 prompt → response 的单次调用。

#### 天级 Agent（Sonnet）

```
Day Distillation Agent (Sonnet)
  │
  ├── 输入：今天的日期
  │
  ├── Tools:
  │   ├── query_episodes(date, filters?)       ← 按条件查当天 episodes 列表
  │   ├── read_episode(id)                      ← 读单个 episode 详情
  │   ├── query_stats(date)                     ← 查当天统计（小时级节奏数据）
  │   ├── read_playbook(path?)                  ← 读当前 Playbook（检查已有模式）
  │   ├── query_history(pattern, date_range)    ← 查历史是否有类似模式
  │   ├── write_day_report(content)             ← 写入日报
  │   └── write_insight(content, confidence)    ← 写入发现到 episodes
  │
  ├── Agent Loop（多轮，典型 4-8 轮）：
  │   Turn 1: query_episodes(today)
  │           → 拿到 45 个 episodes 的摘要列表
  │
  │   Turn 2: "有 8 个跟日程相关的，集中在早上"
  │           → read_episode(id1, id2, id3)
  │           → 看到详情：9:00 问日程、9:05 查天气、9:10 看邮件
  │
  │   Turn 3: "这像是晨间例行流程，查一下历史"
  │           → query_history("早上+日程", last_7_days)
  │           → 发现连续 5 天都有这个模式
  │
  │   Turn 4: "确认是稳定模式，检查 Playbook 有没有记录"
  │           → read_playbook()
  │           → 没有 → write_insight("晨间例行：日程→天气→邮件，已持续5天", 0.7)
  │
  │   Turn 5: "还有 3 个语音消息 episode，之前没见过"
  │           → read_episode(id7, id8, id9)
  │           → 都是在走路时发的（context: 步行中）
  │
  │   Turn 6: "首次使用语音，且都是在移动中"
  │           → query_history("语音", last_30_days)
  │           → 确认是首次
  │           → write_insight("首次使用语音消息，触发条件：移动中", 0.5)
  │
  │   Turn 7: "今天有一个压力标记的 episode"
  │           → read_episode(id12)
  │           → 下午连续切换 app 15 次，最终跳过了测试直接提交
  │           → write_insight("压力下跳过测试", 0.6)
  │
  │   Turn 8: write_day_report(...)
  │           → 综合所有发现，生成日报
  │   Done.
  │
  └── 输出：
      ├── 日报（天级摘要，供周级 Opus 读）
      ├── 新 insights（写入 episodes/，带 confidence）
      └── Playbook 更新建议（不直接改，留给周级确认）
```

#### 周级 Agent（Opus）

周级更复杂——它要做跨日趋势分析、下钻验证、联想发现、Playbook 更新。工具集更丰富。

```
Week Distillation Agent (Opus)
  │
  ├── 输入：本周日期范围
  │
  ├── Tools:
  │   ├── read_day_report(date)                  ← 读某天的日报
  │   ├── drill_down(episode_id)                 ← 下钻到任务级/秒级原始数据
  │   ├── find_similar(behavior, time_range?)    ← 向量搜索相似行为（联想发现）
  │   ├── read_playbook(path?)                   ← 读 Playbook
  │   ├── update_playbook(path, content)         ← 更新 Playbook 条目
  │   ├── create_playbook(name, content)         ← 创建新 Playbook 文件
  │   ├── update_identity(section, content)      ← 更新 Identity
  │   ├── read_meta(type)                        ← 读 confidence/gaps/staleness
  │   ├── update_confidence(trait, value)        ← 更新 confidence
  │   ├── mark_episode_absorbed(ids)             ← 标记已吸收的 episodes（固化）
  │   │
  │   │ 本地工具（自动发现，下钻验证用）：
  │   ├── git_log(repo, since, until)
  │   ├── shell_history(since, until)
  │   ├── browser_history(since, until)
  │   ├── file_changes(dir, since, until)
  │   └── ...（因人而异）
  │
  ├── Agent Loop（多轮，典型 8-15 轮）：
  │   Phase 1 — 全景扫描
  │   Turn 1: 读 7 天日报 → read_day_report(mon..sun)
  │   Turn 2: 读当前 Playbook + confidence → read_playbook(), read_meta("confidence")
  │
  │   Phase 2 — 假设形成
  │   Turn 3: "周三和周四都出现了'跳过测试'的 insight"
  │           → drill_down(episode_id) → 看原始上下文
  │           → git_log(repo, wed, thu) → 确认：都是 hotfix commit
  │           → 假设："紧急修复时跳过测试是稳定模式"
  │
  │   Phase 3 — 交叉验证
  │   Turn 4: find_similar("跳过测试", last_30_days)
  │           → 发现过去一个月有 4 次，全在 hotfix 场景
  │           → 假设确认，confidence 0.85
  │
  │   Turn 5: "晨间例行流程已持续 5 天"
  │           → find_similar("早上+日程", last_30_days)
  │           → 过去 4 周有 3 周出现 → 很稳定
  │
  │   Phase 4 — Playbook 更新
  │   Turn 6: read_playbook("debugging.md")
  │           → 已有 debugging 文件但没有"hotfix 跳过测试"的条目
  │           → update_playbook("debugging.md", 追加情境-行动对)
  │
  │   Turn 7: "晨间例行"是新发现的模式，Playbook 里没有
  │           → create_playbook("morning-routine.md", ...)
  │
  │   Phase 5 — 联想发现
  │   Turn 8: find_similar("选择了更有约束的方案")
  │           → 跨 5 个技术选型场景都选了约束强的方案
  │           → update_identity("values.md", "系统性偏好约束 > 灵活")
  │
  │   Phase 6 — 记忆固化
  │   Turn 9: 已吸收进 Playbook 的 episodes → mark_episode_absorbed(ids)
  │   Turn 10: 更新 confidence → update_confidence(...)
  │   Done.
  │
  └── 输出：
      ├── Playbook 更新（新条目 + 修改现有条目）
      ├── Identity 更新（如果发现新的跨领域模式）
      ├── 记忆固化标记（已吸收的 episodes 可清理）
      └── confidence 刷新
```

#### 为什么不能是单次调用

| | 单次调用 | Agent Loop |
|--|---------|------------|
| 输入量 | 必须一次塞完所有 episodes | 先查列表，按需深挖 |
| 注意力 | 长 prompt → 注意力稀释 | 每轮只关注当前子问题 |
| 策略调整 | 写死在 prompt 里 | 根据中间结果动态决定下一步 |
| 验证 | 没有验证环节 | 假设 → 查证 → 确认/推翻 |
| 下钻 | 不可能 | 需要时调用本地工具精确查 |
| 联想 | 不可能 | find_similar 跨领域搜索 |
| 成本 | 固定（可能更贵，因为 prompt 长） | 按需（简单的一天 4 轮，复杂的 15 轮） |

这就是 OpenClaw "发语音"故事的启示：**让 agent 有工具、有多轮机会，它会自己找到解决方案。** 天级和周级蒸馏的本质是"分析"，分析就是探索，探索就需要 agent loop。

#### 错误恢复

和 OpenClaw 的 model fallback 同理：

```
天级 Agent 运行失败：
  attempt 1: Sonnet → 超时（episodes 太多）
  attempt 2: Sonnet → 加 filter 缩小范围重试
  attempt 3: 降级为 Haiku → 只做统计摘要，不做深度分析
  → 保底产出日报（质量降级但不丢失）

周级 Agent 运行失败：
  attempt 1: Opus → API 限流
  attempt 2: 等待 cooldown → 重试
  attempt 3: 降级为 Sonnet → 做浅层周报，下钻验证留到下周
  → 不影响日常使用，只是 Playbook 更新延迟一周
```

### Playbook 感知：不是独立流程，是 Agent 的自然行为

不需要一个独立的"持久级审计 agent"。Playbook 文件本身有 description，高粒度 agent（天级 Sonnet、周级 Opus）在开始时就能看到所有 Playbook 文件的列表和描述。**Agent 自己决定要不要读、要不要改。**

这和 OpenClaw 的 memory 工具是同一个思路——OpenClaw 不会定时跑一个"记忆整理进程"。它给 agent `memory_search` / `memory_get` 工具，agent 在对话中觉得需要时自己去查。记忆的更新也是 agent 在对话过程中自然发生的（写文件到 memory 目录 → file watcher 检测到 → 自动 embedding）。

#### Playbook 文件结构

每个 Playbook 文件头部带 description，用于让 agent 快速判断是否相关：

```markdown
---
name: debugging
description: 遇到 bug 时的排查策略、工具选择、紧急/非紧急的不同处理方式
maturity: mature
last_updated: 2026-03-10
entry_count: 12
---

## 情境：生产环境紧急 bug
直觉反应：先看日志，不看代码
...
```

#### Agent 启动时的上下文注入

天级或周级 agent 启动时，system prompt 里注入 Playbook 索引（只有文件名 + description，不是全文）：

```
你的 Playbook 技能库（共 7 个文件）：
  debugging.md        — 排查策略、工具选择、紧急/非紧急处理 [mature, 12 条目]
  tech-selection.md   — 技术选型偏好、约束 vs 灵活的权衡 [mature, 8 条目]
  email-triage.md     — 邮件分类转发规则 [developing, 5 条目]
  code-review.md      — review 顺序、关注点 [mature, 9 条目]
  morning-routine.md  — 晨间例行流程 [nascent, 2 条目]
  client-comm.md      — 客户沟通措辞 [developing, 3 条目]
  vendor-selection.md — 供应商选择策略 [developing, 4 条目]

用 read_playbook(path) 读取详情，update_playbook(path, content) 更新。
觉得需要新建技能文件时用 create_playbook(name, content)。
```

Agent 看到今天的 episodes 里有大量 debugging 相关行为 → 自然会 `read_playbook("debugging.md")` → 发现新的模式 → `update_playbook("debugging.md", ...)` 追加条目。

**不需要单独的审计流程。Agent 在做天级/周级分析时，顺手就把 Playbook 维护了。**

#### 为什么这比独立审计更好

```
独立审计流程的问题：
  ├── 过度工程：需要单独的触发条件、单独的 agent、单独的工具集
  ├── 信息割裂：审计 agent 没有当前行为的上下文，只能看文件
  ├── 成本浪费：专门跑一次 Opus 25 轮 loop 只为整理文件
  └── 时机错误：每月一次 → 要么太早（还没积累够）要么太晚（已经碎片化了）

Playbook 感知的优势：
  ├── 自然发生：agent 分析行为时顺手更新，不需要额外流程
  ├── 上下文丰富：agent 正在看今天/本周的 episodes，知道 Playbook 哪里需要改
  ├── 持续维护：每天/每周都在维护，不会等到碎片化了才整理
  └── 零额外成本：Playbook 维护是 agent loop 里的几个额外 turn，不是独立流程
```

#### 跨月模式怎么办？

"他过去 3 个月的 5 次技术选型，4 次选了约束强的"——这种跨月模式，周级 Opus 不是看不到，而是需要工具支持：

```
周级 Opus 的分析过程：
  Turn 3: "这周又一次技术选型选了约束强的方案"
          → read_playbook("tech-selection.md")
          → 已有 7 个同类条目，跨 3 个月
          → "这不是本周的新发现，是一个长期稳定模式"
          → find_similar("选择约束强的方案")
          → 跨技术选型 + 供应商 + 工具选择都有
          → update_identity("values.md", "系统性偏好约束 > 灵活")
```

关键：**Playbook 本身就是跨月记忆**。每个条目带日期和 evidence 引用。周级 Opus 读 Playbook 时，自然能看到这个文件从 3 个月前就开始积累了。不需要一个单独的"持久级"来做这件事——Playbook 文件就是持久层。

#### 技能成熟度：自然涌现，不需要单独评估

Playbook 的 maturity 不需要专门的评估流程。每次 agent 更新 Playbook 时，根据当前状态自动标记：

```
maturity 规则（写在 agent 的 system prompt 里）：

nascent:    条目 < 3 或 confidence 均 < 0.6
developing: 条目 3-8，confidence 多数 0.6-0.8
mature:     条目 > 8，confidence 多数 > 0.8
mastered:   mature + 有反例 + 有压力变体

agent 每次 update_playbook 后自动更新 frontmatter 里的 maturity 字段。
不需要独立的评估流程。
```

技能成熟度地图也是自然产物——读 Playbook 文件列表时就能看到每个文件的 maturity：

```
  debugging:            ████████████░░ mature
  tech-selection:       ██████████████ mastered
  email-triage:         ████████████░░ mature
  client-communication: ████░░░░░░░░░░ developing
  morning-routine:      ██░░░░░░░░░░░░ nascent
  code-review:          ██████████░░░░ mature
  vendor-selection:     ████████░░░░░░ developing

  这不是审计产出，是 Playbook 文件列表的自然呈现。
```

### 成本

```
秒级：  $0（纯规则）
任务级：$0.07/天（Haiku）
小时级：$0（统计）
天级：  $0.03/天（Sonnet，4-8 轮 agent loop）
周级：  $0.15-0.40/天（Opus 均摊，8-15 轮 agent loop + Playbook 维护）
────────────────
总计：  ~$0.25-0.50/天/用户 ≈ $8-15/月/用户
```

---

## 四、记忆系统：五种记忆，五种存储

人脑不是一种记忆——是五种不同系统协作。Agent 的存储也应该是这样。

| 人脑 | Agent 对应 | 存储特征 | 实现 |
|------|-----------|---------|------|
| 工作记忆 | 当前对话 context | 小、快、会丢 | 内存 / session JSON |
| 程序记忆 | Playbook | 可执行的、带情境 | Markdown 文件系统 |
| 语义记忆 | Identity | 抽象的、稳定的 | Markdown 文件系统 |
| 情景记忆 | Episodes | 具体的、按时间排 | 向量 DB + JSONL |
| 元记忆 | Meta | 自知的、动态的 | JSON 文件 |

### 存储结构

```
standmeet-memory/
│
├── playbook/                     ← 程序记忆（核心：复现用的情境-行动对）
│   └── （无预设目录——由蒸馏过程自动涌现）
│       系统观察到足够多的同类行为后，自动创建新文件
│       例：工程师可能涌现 debugging.md、tech-selection.md
│           律师可能涌现 case-research.md、contract-review.md
│           设计师可能涌现 layout-decision.md、client-feedback.md
│           市场人员可能涌现 campaign-planning.md、competitor-analysis.md
│
├── identity/                     ← 语义记忆（Playbook 的解释层）
│   ├── values.md                  ← 底层价值观（约束>灵活、稳定>新潮...）
│   ├── style.md                   ← 表层风格（命名、代码格式、语气）
│   └── rhythm.md                  ← 节奏（深度工作时段、精力分配）
│
├── episodes/                     ← 情景记忆（向量 DB）
│   ├── raw/
│   │   ├── 2026-03-05.jsonl       ← 按天，每条是一个任务级摘要
│   │   └── ...
│   └── index/
│       └── episodes.db            ← sqlite-vec 或 lancedb
│
├── meta/                         ← 元记忆（自知系统）
│   ├── confidence.json            ← 每个 trait 的置信度
│   ├── unanswered.json            ← 别人问了答不上来的问题
│   ├── gaps.jsonl                 ← 观察到行为但推断不出原因的空白（主动提问源）
│   ├── corrections.jsonl          ← agent 草稿 vs 用户实际回复
│   └── staleness.json             ← 每个记忆最后被验证的时间
│
└── context/                      ← 工作记忆（当前对话）
    └── sessions/
        └── {session_id}.json
```

### 为什么 Playbook 是核心，不是 Identity

```
描述性记忆："他偏好 PostgreSQL"
  → 被问"你主人喜欢什么数据库" → "PostgreSQL" → 完了

复现性记忆："当面临数据库选型时..."
  → 被问"新项目该用什么数据库" → 能像他一样推理出答案
```

**记忆的目的是复现，不是描述。** Playbook（怎么做）是主角，Identity（他是谁）是注解。

### Playbook 格式：情境-行动对（不是决策树）

来自认知任务分析（CTA）的洞察：专家靠模式匹配，不是 if-else。

Playbook 文件由系统自动创建——当周级 Opus 分析发现某类行为反复出现（≥3 次同类情境），就为它建一个 Playbook 文件。文件名和分类完全由 model 决定，不预设。

```markdown
# [系统自动命名].md
# 例：工程师 → tool-selection.md
#     律师 → case-research-strategy.md
#     设计师 → client-revision-handling.md
#     市场人员 → channel-budget-allocation.md

## 情境：[具体情境描述]
直觉反应：[观察到的第一反应]
为什么：[从行为推断的原因]
置信度：0.9

## 情境：[同类但不同条件]
直觉反应：[不同的反应]
为什么：[不同条件导致不同选择]
置信度：0.8

## 情境：[对方提出特定要求]
反应：[行为描述]
为什么：[推断的原因]
置信度：0.7

## 底层价值观
→ [跨情境归纳出的共性]
→ [什么条件下灵活，什么条件下坚持]

## 反例
[日期] [违反常规模式的行为]
→ 边界条件：[为什么这次不同]
→ evidence: task-XXXXXXXX-XXXX
```

具体例子——这不是预设，是涌现后的样子：

```
一个律师用户的 playbook/ 可能长这样：
├── case-research-strategy.md     ← 怎么查案例（先判例还是先法条）
├── contract-red-flags.md          ← 看合同时注意什么
├── client-communication.md        ← 怎么和客户说坏消息
├── deadline-triage.md             ← 多个 deadline 冲突时怎么排
└── opposing-counsel-style.md      ← 对方律师激进时怎么应对

一个市场人员的 playbook/ 可能长这样：
├── campaign-planning.md           ← 怎么规划一个新 campaign
├── budget-allocation.md           ← 预算怎么分
├── data-interpretation.md         ← 看到数据波动时怎么判断
├── vendor-negotiation.md          ← 和供应商谈价
└── crisis-response.md             ← 公关危机怎么处理
```

### 为什么是 Markdown 文件系统

```
数据库：
  SELECT * FROM traits WHERE category = 'coding'
  → 扁平，没有层级，加新维度要改 schema

文件系统：
  ls playbook/
  → tech-selection.md  debugging.md  communication.md
  → 天然层级，加新维度就是加一个文件
  → LLM 天然理解文件路径
```

而且 StandMeet 已经有基于路径的内容系统（`/repo/<path>/`）。记忆系统直接复用——**记忆就是 content，content 就是记忆**。

### Agent 运行时的查找顺序

```
对方问一个专业问题（工程师："这个 bug 怎么修？" / 律师："这个条款有风险吗？"）

1. playbook/ → 找到对应情境-行动对 → 按模式回答
2. meta/confidence.json → 该领域置信度 0.8 → 可以自信回答
3. 回答时引用情境和行动

对方问一个非专业问题："你主人喜欢什么音乐？"

1. playbook/ → 没有音乐相关
2. identity/ → 没有
3. episodes/ 向量搜索 → 找到原始摘要：
   "3/5 听了 12 首 post-rock"、"3/7 工作时听 lo-fi"
4. meta/confidence.json → 没有这个维度
5. 回答加"据我观察"前缀（隐性知识，从 episodes 涌现）

对方问一个超出观察范围的问题："你主人怎么看中美关系？"

1-3 都没有
4. 回复："这个我不确定，你直接问他吧"
5. 写入 meta/unanswered.json → 反馈为蒸馏优先级
```

---

## 五、记忆固化与遗忘

原始摘要池（episodes/）不能无限增长。搜索质量会随数据量退化。

人脑的方案：**遗忘是功能，不是 bug。** 具体事件（情景记忆）在睡眠中固化为抽象模式（语义记忆），细节丢掉但规律留下。

### 固化策略

```
0-30 天：全保留（新鲜，随时可能被需要）

30-90 天：
  被检索过的 → 保留（被回忆 = 被强化，Ebbinghaus 效应）
  从未被检索 → 检查是否已被 Playbook 吸收
    已吸收 → 删原文，Playbook 保留 evidence 引用
    未吸收 → 降级为压缩版（300字 → 50字摘要）

90 天+：
  被检索过 2 次以上 → 保留
  压缩版也没被检索过 → 删除

永久保留：
  被 Playbook 引用为反例的（边界条件很珍贵）
  主动学习回路的校准记录（每条都有价值）
  高阶 model 标记为"有趣"的
```

### 稳态大小

```
每天 50 条摘要
30 天后保留 ~30%（被检索过 or 未吸收）= 15 条
90 天后保留 ~10% = 5 条

稳态 ≈ 30天×50 + 60天×15 + 长期×5×月数
     ≈ 前几个月 ~2,400 条，之后每年增长 ~300 条
向量 DB 稳态 ≈ 3,000-5,000 条 → 搜索质量不退化
```

### "睡眠" = 周级 Opus 分析

每周跑一次 Opus 分析，同时做三件事：
1. 蒸馏新的 Playbook 条目 / 更新已有条目
2. 把已吸收的 episodes 标记为可清理
3. 刷新 staleness.json（超过 30 天未验证的记忆标记为 stale）

---

## 六、索引链 + 下钻到本地工具

每层摘要带源引用 ID。高层可以沿链路下钻，**最底层不是 Screenpipe 事件，是本地工具**。

```
例 1（工程师）：
周报 trait: "条件性 TDD"  (confidence: 0.6)
  ├─ evidence: day-20260305 → "3 个 fix，2 个先写测试"
  │    └─ source: task-1032 → screenpipe + git_log 下钻
  └─ evidence: day-20260307 → "直接改代码没写测试" (pressure: true)
       └─ git_log 确认 → context: "紧急 hotfix，客户在等"
  → 纠正："非紧急时 TDD，紧急时跳过 → 测试是纪律不是直觉"

例 2（律师）：
周报 trait: "习惯先查判例再查法条"  (confidence: 0.7)
  ├─ evidence: day-20260305 → "合同纠纷，先 Westlaw 后法条"
  │    └─ source: task-0930 → browser_history 下钻
  │         → 3 个判例页面 → 2 个法条页面 → Word 写意见
  └─ evidence: day-20260308 → "直接写意见没查判例" (pressure: true)
       └─ browser_history → 只打开了 1 个法条页面
       → context: "当天提交截止，来不及查判例"
  → 纠正："判例优先是纪律，不是直觉——时间紧时跳过"

通用结构：
  周报 trait → 日报 evidence → 任务 source → screenpipe + 本地工具下钻
  多条 evidence 交叉验证，尤其关注常态 vs 压力下的差异
```

### 高阶 model 的完整工具集

```
蒸馏工具（固定）：
  read_summary(date)                    → 读某天的日报
  drill_down(chunk_id)                  → 下钻到任务级/秒级
  find_similar(behavior, time_range?)   → 向量搜索相似行为

本地工具（自动发现，因人而异）：
  通用：file_changes / app_usage / clipboard_history
  工程师可能有：git_log / shell_history / docker_logs
  律师可能有：browser_history（Westlaw/判例数据库）
  设计师可能有：figma_history / file_changes（.fig/.psd 修改）
  市场可能有：browser_history / calendar_events / email_folders

  系统启动时自动扫描环境，注册可用工具。
  高阶 model 不需要知道用户是什么职业——它有什么工具就用什么。
```

Screenpipe 是广度采样层（什么都看一眼），本地工具是深度精确层（需要时深挖）。两层配合，不需要预灌数据。

---

## 七、联想发现

### 不需要设计好奇心，给工具就行

高阶 model 在做周报分析时，自然会需要更多例证。

```
例 1（工程师）：Opus 归纳"技术选型偏好"
  → find_similar("选择了更有约束的方案")
  → 返回跨 5 个技术领域的相同模式
  → WHY："系统性偏好约束——不是不知道灵活方案，是主动回避"

例 2（律师）：Opus 归纳"案件策略偏好"
  → find_similar("选择了更保守的法律论点")
  → 返回：合同纠纷选违约不选侵权、劳动争议先调解后仲裁、知产案先发警告函...
  → WHY："风险规避型——倾向可预测的路径，不赌大的"

例 3（设计师）：Opus 归纳"排版决策偏好"
  → find_similar("拒绝客户的修改建议")
  → 返回：拒绝加大 logo、拒绝用更亮的颜色、拒绝加更多文字...
  → WHY："守住负空间——宁可和客户争论，也不让页面变拥挤"
```

这些 insight 没人写规则提取。它从多个 WHAT 中涌现出 WHY——**无论什么职业，人的决策模式都有跨情境的一致性**。

---

## 八、主动学习回路

### 8.1 Agent 草稿 vs 用户实际回复（DAgger 原理）

```
对方问了一个问题
  → agent 生成草稿回复（但不发出）
  → 用户偶尔自己上线，亲自回复
  → 系统对比：
      工程师场景：agent "可以考虑" vs 用户 "不行，latency 会炸"
      律师场景：  agent "这个条款有风险" vs 用户 "这个必须删掉，没得谈"
      设计场景：  agent "可以试试蓝色" vs 用户 "绝对不行，品牌色不能动"
  → diff 暴露：agent 缺少专业判断力，只会给模糊建议
  → 校准信号写回 Playbook + Identity
```

行为克隆的 DAgger 算法告诉我们：**边界纠正数据比正常数据有价值得多**。应该故意让 agent 在不确定的场景回答，等待用户纠正。

### 8.2 未答问题反馈为蒸馏优先级

```
对方问："你主人怎么看 AI 安全？"
  → 答不上来 → "你直接问他吧"
  → 记录到 meta/unanswered.json
  → 下次观察到用户读 AI 安全文章 → 优先蒸馏这个维度
```

**被问到但答不上来的问题，是最好的蒸馏优先级信号。** 系统不需要蒸馏一切——只需要蒸馏会被问到的东西。

### 8.3 主动提问：补全观察盲区

系统能看到行为结果，但有些决策过程完全发生在脑子里——屏幕上只有"做了"，没有"为什么"。系统检测到这类空白后，主动向用户提问。

**和写日报的区别**：日报是开放式作文（用户自己想写什么写什么，通常是废话）。系统提问是精确采访——它知道哪里有信息缺口，问的是具体决策。

```
日报："今天处理了财务相关工作"
系统提问："你 10:30 给财务说'按方案二走'，方案一和方案二的区别是什么？你怎么选的？"
```

#### 空白检测

```
记录在 meta/gaps.jsonl：
  {
    "observed": "关掉 Excel → 邮件说按方案二走",
    "gap": "方案一二的区别？选择依据？",
    "context": "task-20260311-1030",
    "asked": false,
    "priority": 0.9
  }
```

#### 什么值得问

```
高优先（主动问）：
  决策但看不到过程 → "你选了 A 不选 B，为什么？"
  回避但不知道原因 → "你有 X 工具但没用，是故意的吗？"
  压力下的异常行为 → "你今天跳过了通常会做的 Y，是来不及还是觉得没必要？"
  反复修改 → "你改了四遍开头，最后选的这版和前面的区别在哪？"

低优先（先不问）：
  纯执行细节 → 怎么调的公式不重要，选了什么方案才重要
  节奏类空白 → 为什么上午不看邮件，可能就是习惯
  已有足够同类样本的模式 → Playbook 已经有 5 个同类情境了，不缺这一个
```

#### 提问频率

一天最多 2-3 个问题。多了就变成另一种日报。攒着问，挑最高优先级的。可以在用户一天工作结束后统一推送（"今天有 2 个问题想请教你"），也可以在检测到空闲时段时插入。

#### 回答如何整合进记忆

用户的回答是**最高质量的蒸馏信号**——比任何行为观察都精确，因为是用户亲口说的 why。

整合路径：

```
1. 立即写入 episodes/（作为特殊类型的摘要）
   {
     "type": "user_explanation",        ← 区别于 observation 类型
     "question": "方案一二怎么选的？",
     "answer": "方案一便宜但要换供应商，换供应商的隐性成本太高",
     "source_gap": "task-20260311-1030",
     "timestamp": "2026-03-11T18:30:00"
   }
   → 进入向量 DB，可被 find_similar 检索

2. 尝试直接更新 Playbook
   系统检查：playbook/ 里有没有已存在的相关文件？

   有 → 追加一个情境-行动对：
     ## 情境：两个方案，一个便宜但要换供应商
     直觉反应：选贵的，不换供应商
     为什么：隐性成本（切换成本、磨合期、风险）> 价格差
     置信度：0.7（只有一个样本，先低置信度）
     来源：用户直接解释，task-20260311-1030

   没有 → 先存在 episodes 里等积累
     等同类情境出现 3+ 次后（可能部分来自观察、部分来自提问），
     周级 Opus 自动创建新的 Playbook 文件

3. 可能触发 Identity 更新
   如果这个回答暴露了一个底层价值观：
     "隐性成本 > 显性成本" → 写入 identity/values.md
     "他系统性地高估切换成本" → 这是一个跨领域的偏好

   但 Identity 更新只在周级 Opus 分析时做，不立即做
   → 避免单个回答过度影响人格模型

4. 关联补全
   这个回答同时解释了之前观察到但没理解的行为：
     "2/20 选了贵 30% 的服务商"（之前在 episodes 里标记为 unexplained）
     "3/5 否决了实习生找的便宜方案"（同上）
   → find_similar("选了更贵的方案") → 找到这些
   → 之前 unexplained 的 episodes 现在有了解释
   → 下次周级分析时，Opus 看到 3 个同类 → 直接建 Playbook 文件

5. 更新 meta/gaps.jsonl
   asked: true, answer_received: true
   → 这个空白已补全
   → confidence.json 中相关 trait 的置信度上调
```

#### 用户回答 vs 行为观察的权重

```
用户亲口说的 WHY：
  ✅ 高精度（他说的就是他想的——大概率）
  ❌ 可能是事后合理化（人会美化自己的决策过程）
  → 置信度 0.7，需要后续行为验证

行为观察推断的 WHY：
  ✅ 不会自我美化（行为不说谎）
  ❌ 推断可能错（行为相同但原因不同）
  → 置信度 0.5-0.6

两者一致时：
  → 置信度直接拉到 0.9
  → 这是最强的蒸馏信号

两者矛盾时：
  → 标记为冲突，不急着下结论
  → 可能他说的是理想状态，做的是真实状态
  → 这本身就是一个有价值的 insight："他认为自己 X，实际行为 Y"
  → 写入 identity/values.md 作为"自我认知偏差"
```

#### 为什么这比日报好

```
日报是员工写给老板的 → 信息方向：向上汇报 → 自然会美化、省略、注水
系统提问是工具问用户的 → 信息方向：教学徒 → 用户没有动机撒谎

日报的问题是：写的人不知道读的人需要什么
系统提问解决了这个问题：系统精确知道自己缺什么信息
```

---

## 九、Chunk 边界问题

不需要过度担心。**蒸馏的是模式，不是内容。模式是冗余的。**

一个人的方法论会反复出现。漏掉一次跨 chunk 的实例，还有下次。

低频高价值决策（技术选型，一个月一两次）由任务边界检测（2.4）+ 本地工具下钻（六）覆盖——Screenpipe 漏了，git log 不会漏。

---

## 十、完整数据流

```
采集层
├── Screenpipe 原始流（广度采样，~100MB/天）
└── 本地工具日志（深度精确，按需查询，零预存储）
         │
         ▼
信号过滤层
├── 转折点检测（做了什么）
├── 回避模式检测（没做什么）
├── 压力状态标记（状态变化）
└── 任务边界检测（自然切分）
         │
         │ 高信号事件（~5MB/天）
         ▼
多层蒸馏管线
├── 秒级：规则 → 微操特征
├── 任务级：Haiku → 方法论 ──→ 同时写入 Episodes 向量 DB
├── 小时级：统计 → 节奏模式
├── 天级：Sonnet agent loop → 决策风格 + 日报
│        └── Playbook 感知（看到索引 → 觉得相关就读 → 顺手更新）
└── 周级：Opus agent loop → Playbook + Identity + 记忆固化
         ├── Playbook 感知（启动时注入索引，自主读写维护）
         ├── 下钻验证（索引链 → Screenpipe → 本地工具）
         ├── 联想发现（find_similar 跨领域搜索）
         └── 记忆固化（已吸收的 episodes 标记清理）

记忆系统
├── playbook/（情境-行动对，复现用，Markdown）
├── identity/（价值观 + 风格，兜底用，Markdown）
├── episodes/（原始摘要，向量 DB，涌现 + 隐性知识）
│   └── 固化策略：0-30天全留，30-90天按检索频率，90天+清理
│       稳态 ~3,000-5,000 条
├── meta/（confidence + 未答问题 + 校准记录 + 新鲜度）
└── context/（当前会话，不持久化）

主动提问回路
├── 检测空白 → meta/gaps.jsonl
├── 每天 2-3 个高优先问题 → 推送给用户
├── 用户回答 → 写入 episodes（user_explanation 类型）
├── 尝试直接更新 Playbook（单样本低置信度）
├── find_similar 关联之前 unexplained 的 episodes
└── 行为观察 + 用户解释 一致 → confidence 拉到 0.9

输出到 Agent
├── 查 Playbook → 情境匹配 → 复现行为
├── 查 Identity → 价值观推理 → 未见场景兜底
├── 查 Episodes → 向量搜索 → 临场涌现
├── 查 Meta → confidence 门槛 → 不确定就说不知道
└── 主动学习 → agent 草稿 vs 实际回复 → 持续校准

~$0.25-0.50/天 ≈ $8-15/月/用户（蒸馏成本，不含执行层）
```

---

## 十一、执行层

蒸馏和记忆解决"知道怎么做"，执行层解决"替他做"。

架构直接复用 OpenClaw 已验证的模式：**agent loop + MCP 工具调用**。唯一的区别是 OpenClaw 靠用户下指令触发，StandMeet 靠情境匹配自动触发。

### 架构

```
                    ┌──────────────────────────────────┐
                    │  情境检测（Screenpipe 实时流）      │
                    │  "收到一封供应商报价邮件"           │
                    └──────────────┬───────────────────┘
                                   │
                                   ▼
                    ┌──────────────────────────────────┐
                    │  Playbook 匹配                     │
                    │  查 playbook/ → 有匹配的情境-行动对？│
                    │  confidence ≥ 0.95？               │
                    └──────┬───────────────┬────────────┘
                           │               │
                     confidence ≥ 0.95   confidence < 0.95
                           │               │
                           ▼               ▼
                    ┌─────────────┐  ┌─────────────────┐
                    │  自动执行     │  │  建议模式         │
                    │  agent 直接做 │  │  草拟方案给用户看  │
                    │  做完通知用户 │  │  用户确认后执行    │
                    └──────┬──────┘  └────────┬────────┘
                           │                  │
                           ▼                  ▼
                    ┌──────────────────────────────────┐
                    │  Agent Loop（OpenClaw 模式）        │
                    │                                    │
                    │  System Prompt:                     │
                    │    Playbook 情境-行动对              │
                    │    + Identity 风格/价值观            │
                    │    + 相关 Episodes（向量检索）        │
                    │                                    │
                    │  Tools（MCP）:                      │
                    │    用户电脑上已有的工具               │
                    │                                    │
                    │  Loop:                              │
                    │    LLM → tool_use → call → result  │
                    │    → LLM → tool_use → ...          │
                    │    → 直到任务完成                    │
                    └──────────────┬───────────────────┘
                                   │
                                   ▼
                    ┌──────────────────────────────────┐
                    │  执行结果 → 反馈回蒸馏系统           │
                    │  用户接受？修改？拒绝？              │
                    │  → 校准 Playbook confidence         │
                    └──────────────────────────────────┘
```

### 触发模式：三档

```
档位 1：全自动（confidence ≥ 0.95 + 用户已授权该类操作）
  情境："收到供应商报价邮件"
  Playbook："转发给财务 + 标记'待比价'"
  → 直接做，做完在通知栏显示"已转发给财务"
  适合：高频、低风险、模式极度稳定的操作
  例：邮件分类转发、日程提醒、文档归档、固定格式报告生成

档位 2：建议确认（confidence 0.7-0.95 或操作有副作用）
  情境："客户问能不能打折"
  Playbook："通常不主动打折，但老客户可以给 5%"
  → 草拟回复给用户看，用户点确认才发
  适合：有判断空间的操作、对外沟通、涉及金额
  例：邮件草稿、方案建议、排优先级建议

档位 3：纯观察（confidence < 0.7 或全新情境）
  情境：从没见过的类型
  → 不做任何事，只观察用户怎么处理
  → 结果进入蒸馏管线，积累样本
  适合：新场景、Playbook 还没覆盖的领域
```

### 工具层：MCP 复用用户环境

不需要为 StandMeet 单独建工具体系。用户电脑上能做的事，agent 通过 MCP 都能做：

```
已有工具生态（直接接入）：
  邮件：读/写/转发/标记（Apple Mail / Outlook MCP）
  日历：创建/修改/查询事件（Calendar MCP）
  文件：读/写/移动/重命名（File System MCP）
  浏览器：打开页面/填表/搜索（Browser MCP）
  消息：发送/回复（Slack / Teams / 微信 MCP）
  文档：读/写/格式化（Google Docs / Office MCP）

和 OpenClaw 的区别：
  OpenClaw：54 个 bundled skills，通用能力
  StandMeet：同样的 MCP 工具，但 agent 的"怎么用"来自 Playbook
            → 不是通用助手，是"像你一样用这些工具"
```

### System Prompt 构造

每次执行时，动态拼装 system prompt：

```
你是 {用户名} 的数字分身。按照以下方式处理当前情境。

## 当前情境
{Screenpipe 检测到的情境描述}

## 相关 Playbook
{从 playbook/ 检索到的匹配情境-行动对，含置信度}

## 行为风格
{identity/style.md 的相关段落}

## 底层价值观
{identity/values.md 的相关段落}

## 类似历史
{从 episodes/ 向量检索的 top-3 相似场景}

## 约束
- confidence < 0.7 的判断，说"我不确定"并建议用户自己决定
- 涉及金额/对外沟通/权限操作，必须用户确认
- 做完后简短通知用户做了什么
```

这个 prompt 结构和 OpenClaw 的 AGENTS.md 本质一样——都是给 agent 行为边界。区别是 OpenClaw 的规则是人写的，StandMeet 的规则是蒸馏出来的。

### 执行结果反馈回蒸馏

执行层不是终点——执行结果是蒸馏系统的高质量输入：

```
自动执行后用户的反应：

接受（没改）
  → Playbook 该条目 confidence +0.02
  → 这个模式更稳固了

修改后接受
  → DAgger 信号：agent 做的 vs 用户改的 diff
  → 写入 meta/corrections.jsonl
  → Playbook 该条目追加一个情境分支
  例："转发给财务"被用户改成"转发给财务 + CC 老板"
  → 新增情境："金额超过 X 时，CC 老板"

拒绝
  → Playbook 该条目 confidence -0.05
  → 标记为需要更多样本
  → 如果连续被拒绝 3 次 → 该条目降级为"建议模式"

用户自己做了（agent 没触发但用户手动做了）
  → 说明情境检测漏了，或 Playbook 没覆盖
  → 写入 meta/gaps.jsonl → 主动提问候选
```

### 安全边界

```
永远不自动做：
  ❌ 删除文件/邮件（不可逆）
  ❌ 发送金额相关内容（转账、报价、合同）
  ❌ 修改权限/密码
  ❌ 对外发布内容（社交媒体、公告）
  ❌ Playbook 里没有的操作（不能"创造性执行"）

可以自动做（在用户授权后）：
  ✅ 邮件分类、标记、转发（给内部人）
  ✅ 日程创建、提醒设置
  ✅ 文件归档、重命名
  ✅ 信息查询（不修改任何东西）
  ✅ 草稿生成（不发送）
```

### 和蒸馏层的关系

```
蒸馏层：观察 → 学习 → 记住（Playbook + Identity + Episodes）
执行层：识别情境 → 查记忆 → 执行 → 结果反馈回蒸馏层

蒸馏层让执行层越来越准：
  第 1 月：几乎全是档位 3（纯观察），偶尔档位 2（建议）
  第 3 月：大部分档位 2，少量档位 1（全自动）
  第 6 月：高频操作全是档位 1，只有新场景才是档位 3
  → 系统越用越像用户自己

执行层让蒸馏层越来越快：
  每次执行 = 一次主动实验
  用户对执行结果的反应 = 最精确的校准信号
  → 比纯观察学得快，因为有反馈
```

### 成本

```
执行层成本取决于触发频率和任务复杂度：

档位 1（全自动，简单操作）：
  Haiku 做情境匹配 + 1-2 次工具调用
  ~$0.001/次，一天 20 次 = $0.02/天

档位 2（建议确认，中等操作）：
  Sonnet 生成草稿 + 用户确认 + 执行
  ~$0.01/次，一天 5 次 = $0.05/天

执行层总计：~$0.07/天

加上蒸馏层 $0.25-0.50/天
────────────────
全系统（个人）：~$0.32-0.57/天 ≈ $10-17/月/用户
```

---

## 十二、Playbook 评级系统

### 核心定义

**学成 = 在该 Playbook 文件对应的情境子域内，bisimulation distance → 0。**

Bisimulation distance 不可直接测量——我们看不到用户的内部状态 S。用四个可观测的 proxy 逼近，每个恰好对应 bisimulation failure 的一个来源。

### 12.1 四个评级指标

#### 发现率衰减 d(t)（对应 failure type I — 情境空间收敛度）

最关键的指标。如果每周还在冒出从没见过的情境变体，说明情境空间 I 还没被充分探索，不可能学成。

```
d(t) = 本周新增情境变体数 / 本周该域总 episode 数

d(t) → 0：情境空间已被充分探索
d(t) 持续 > 0.3：该域情境还在扩张，不可能收敛

本质：测 I 的熵。熵降到接近零 = prompt（商算子）已充分划分该域。
```

例子：

```
debugging.md 连续四周：
  d = 0.6 → 0.4 → 0.2 → 0.05
  → 正在收敛，第 4 周几乎没有新变体

client-comm.md 连续四周：
  d = 0.5 → 0.5 → 0.4 → 0.3
  → 没收敛，客户场景还在不断出新的
```

#### 预测准确率 p（对应 failure type β — agent 模型准确度）

```
p = Σ(accepted × 1.0 + modified × 0.5 + rejected × 0.0) / total_executions

带指数时间衰减：近期执行权重更高。

影子模式（shadow accuracy）：
  agent 没真的执行，但后台生成了草稿
  用户自己做了 → 比对 diff → shadow_accuracy
  这个指标在 observe/suggest 模式下也能收集
```

#### 修改率衰减 m(t)（对应 failure type α — 用户行为稳定度）

```
m(t) = 本周蒸馏系统修改该 Playbook 文件的次数

m(t) → 0：用户行为在该域已稳定，每周分析都没什么要改的
m(t) 突然飙升：用户在变（换了工作方式/工具/团队），bisimulation 正在失效

注意：这里计的是蒸馏系统的修改，不是用户手动编辑。
用户手动编辑 Playbook 是另一种高质量信号（类似主动提问的回答）。
```

#### 边界完备度 b（对应 failure type F — 观测充分度）

```
b = (has_counterexamples ? 0.5 : 0) + (has_pressure_variants ? 0.5 : 0)

没有反例 = 不知道边界在哪
  → 可能在边界处 catastrophic failure
  → "他总是选 PostgreSQL"——但什么条件下他不选？不知道。

没有压力变体 = 分不清纪律和直觉
  → "他总是跑测试"——是内化的还是后天纪律？不知道。
  → 压力下丢掉的 = 纪律，保留的 = 直觉
  → 分不清这个，bisimulation 的粒度不够细
```

### 12.2 评级存储格式

每个 Playbook 文件一个评级记录，存在 `meta_ratings` 表：

```json
{
  "ratings": {
    "debugging.md": {
      "discovery_rate": 0.05,
      "prediction_accuracy": 0.91,
      "modification_rate": 0.02,
      "boundary_completeness": 1.0,
      "sample_size": 47,
      "execution_mode": "auto",
      "last_verified": "2026-03-10",
      "history": [
        {"week": "2026-W08", "d": 0.6, "p": null, "m": 0.8, "b": 0.0},
        {"week": "2026-W09", "d": 0.4, "p": null, "m": 0.5, "b": 0.0},
        {"week": "2026-W10", "d": 0.2, "p": 0.72, "m": 0.3, "b": 0.5},
        {"week": "2026-W11", "d": 0.05, "p": 0.91, "m": 0.02, "b": 1.0}
      ]
    }
  }
}
```

`history` 记录每周的指标快照，用于观察收敛趋势。周级 Opus 每次分析时更新。

### 12.3 执行模式阈值

四个条件的组合决定执行模式，缺一个都不能升级：

```
auto:    d < 0.1  AND  p > 0.9  AND  m < 0.1  AND  b = 1.0  AND  sample ≥ 20
suggest: d < 0.3  AND  p > 0.7  AND  sample ≥ 5
observe: 其余
```

为什么每个条件都不可缺：

| 条件不满足 | 含义 | 风险 |
|-----------|------|------|
| d ≥ 0.1 | 情境空间还在扩张 | 遇到新变体时 agent 会用错误的模式处理 |
| p ≤ 0.9 | agent 模型还不够准 | 每 10 次执行有 1 次以上会出错 |
| m ≥ 0.1 | 用户行为还在变 | Playbook 记录的可能已经过时 |
| b < 1.0 | 边界不清楚 | 正常情况没问题，边界情况可能 catastrophic |
| sample < 20 | 样本不够 | 统计意义不足 |

### 12.4 降级触发

升级慢，降级快——保守策略，因为自动执行出错的代价远高于多确认一次。

```
立即降级（auto → suggest）：
  - 任何一次 reject
  - 理由：β 出了问题，模型在该情境的预测不准

审查降级（auto → suggest，并标记需要 Opus 审查）：
  - 连续 3 次 modify（即使没有 reject）
  - 理由：β 有系统性偏差，不是偶然错误

观察降级（任何模式 → observe）：
  - m(t) 突然上升（定义：m(t) > 3 × 过去 4 周均值）
  - 理由：α 在变，用户行为模式正在转变，之前的 bisimulation 失效

主动扰动（auto 保持，但临时降为 suggest 验证一次）：
  - 该条目 60 天未被验证（last_verified 超期）
  - 理由：von Foerster 二阶控制论——控制器会漂移
  - 频率：每天最多 1-2 次扰动，不影响体验
  - 用户确认 → last_verified 刷新
  - 用户修改 → 发现漂移，更新 Playbook，降回 suggest
  - 用户拒绝 → 条目可能已过时，降回 observe
```

### 12.5 评级更新时机

```
实时更新：
  - prediction_accuracy：每次执行后立即更新（接受/修改/拒绝）
  - execution_mode：每次降级触发时立即变更

周级更新（Opus 分析时）：
  - discovery_rate：需要看一周的 episode 才有意义
  - modification_rate：按周统计
  - boundary_completeness：Opus 检查是否新增了反例或压力变体
  - sample_size：累加
  - history：追加本周快照

升级检查（周级更新后）：
  - observe → suggest：检查 d < 0.3 AND p > 0.7 AND sample ≥ 5
  - suggest → auto：检查全部 5 个条件
  - 升级需要连续 2 周满足条件（防止偶然波动）
```

### 12.6 与蒸馏管线的关系

评级系统不是独立模块——它是周级 Opus 分析的自然产物。Opus 每周更新 Playbook 时，顺手就把评级更新了：

```
Week Distillation Agent (Opus)
  ...
  Phase 6 — 评级更新
  Turn N: read_meta("rating")
          → 计算本周各 Playbook 的 d(t) 和 m(t)
          → 检查是否新增反例/压力变体 → 更新 b
          → 检查升级条件
          → update_meta("rating", ...)
  ...
```

执行层读取 `meta_ratings` 表决定三档触发模式，不需要自己做评估。

---

## 十三、控制论框架

整个系统本质上是一个控制论系统——通过反馈回路在不确定环境中维持有效控制。显式使用控制论框架暴露了三个纯工程思维容易忽略的设计要素。

### 13.1 Ashby 必要多样性定律：Playbook 完备性指标

> "只有多样性才能消灭多样性。" —— W. Ross Ashby, 1956

控制器（Playbook）的情境覆盖必须 ≥ 被控系统（用户实际工作）的情境多样性。不够就失控——系统只能观察，不能执行。

```
量化：
  本周用户遇到 40 种可识别情境
  Playbook 覆盖了 28 种（confidence ≥ 0.7）
  → 覆盖率 = 28/40 = 70%

  覆盖率含义：
  > 90%：系统接近"数字分身"，大部分事可以代做
  70-90%：有用的助手，但常遇到不会的
  < 70%：还在学习期，主要价值是观察和记录

  这个数字本身就是产品价值的度量。
  可以展示给用户："你的数字分身已经学会了你 78% 的工作模式。"
```

多样性还有第二层含义——**Playbook 内部的情境分支够不够细**：

```
粗粒度（多样性不足）：
  playbook/email-response.md 只有 1 个情境-行动对
  → 所有邮件都用同一种方式回 → 必然出错

细粒度（多样性充足）：
  playbook/email-response.md 有 12 个情境-行动对
  → 区分了：上级/平级/客户/供应商 × 紧急/常规/敏感
  → 每种情境有不同的措辞和处理方式
  → 多样性匹配了真实世界的复杂度
```

### 13.2 二阶控制论：观察改变行为，控制器会漂移

> "观察者不在系统之外——观察者就是系统的一部分。" —— Heinz von Foerster, 1974

**第一个问题：观察改变被观察者。**

用户知道系统在学习他的行为。这可能导致：
- 正面：用户更自律（"系统在看，我认真点"）
- 负面：用户表演性工作（"让系统学到我很勤奋"）
- 实际影响可能很小——三个月后用户会忘记系统在运行，就像忘记手环在手上

**第二个问题：执行漂移。** 这个更严重。

```
漂移过程：
  1. Playbook 条目 A 达到 confidence 0.97 → 升级为全自动
  2. 系统自动执行条目 A，用户不再亲自做
  3. 3 个月过去，用户的实际偏好已经变了
     （换了供应商、团队结构调整、市场环境变化...）
  4. 但 Playbook 条目 A 的 confidence 还是 0.97
     → 因为没有负反馈：用户不做了，就没有行为数据来纠偏
     → 系统还在按旧模式执行
  5. 直到某次执行结果出了问题，用户才发现

  这就是二阶控制论的核心警告：
  控制器（Playbook）和被控系统（用户行为）会脱耦
```

**对策：主动扰动（perturbation）**

```
全自动条目的防漂移机制：
  每 30 天，随机选 10% 的全自动条目
  → 强制降回"建议模式"一次
  → 用户被迫看一眼："系统要帮你转发这封邮件给财务，确认吗？"
  → 用户确认 → confidence 刷新（验证过了，不是惯性留下的）
  → 用户修改 → 发现漂移，更新 Playbook
  → 用户拒绝 → 条目可能已过时，降回观察模式

  频率控制：
  不是每个条目每次都问（那就不是自动化了）
  而是采样式验证——像审计，不是像审批
  用户每天最多被"扰动"1-2 次，不影响体验
```

### 13.3 正反馈：不只纠偏，也放大好的变化

传统控制论关注负反馈（纠偏）。但正反馈（放大）同样有价值。

```
负反馈（已有）：
  agent 做错了 → 用户纠正 → Playbook 更新
  "你上次转发错了人" → 修正

正反馈（新增）：
  用户行为出现积极变化 → 系统检测并固化
  "你这周处理报价比上周快了 40%"
  → 系统分析 diff：跳过了供应商资质复核步骤
  → 两种可能：
     a. 用户发现这步没必要（效率提升）→ 固化为新模式
     b. 用户偷懒了（质量下降）→ 不固化，标记观察
  → 怎么区分：看后果。如果跳过后没出问题 × 3 次 → 大概率是 a

  正反馈的价值：
  不只是"学你现在怎么做"
  也是"学你正在变成什么样"
  → 系统能跟上用户的进化，不只是固化用户的过去
```

### 13.4 控制论视角下的完整系统

```
                    ┌─────────────────────────┐
                    │  环境（用户的工作世界）    │
                    └────────┬────────────────┘
                             │ 扰动（新任务、变化、压力）
                             ▼
┌─────────────────────────────────────────────────────┐
│  传感器（Screenpipe + 本地工具）                       │
│  → Ashby：传感器的多样性 ≥ 环境的多样性               │
│    才能捕获足够信号                                    │
└────────────────────┬────────────────────────────────┘
                     │ 观察
                     ▼
┌─────────────────────────────────────────────────────┐
│  控制器（蒸馏管线 + 记忆系统）                         │
│  → Ashby：Playbook 的情境多样性 ≥ 用户行为多样性      │
│  → von Foerster：控制器本身会漂移，需要主动扰动验证    │
└────────────────────┬────────────────────────────────┘
                     │ 执行
                     ▼
┌─────────────────────────────────────────────────────┐
│  执行器（Agent + MCP 工具）                           │
│  → 负反馈：执行错误 → 纠正 Playbook                   │
│  → 正反馈：执行改善 → 固化新模式                       │
│  → 二阶效应：执行改变了用户的行为 → 回到传感器重新观察  │
└────────────────────┬────────────────────────────────┘
                     │ 反馈
                     ▼
              回到传感器（闭环）
```

---

## 十四、组织级递归：从个人 Playbook 到组织 Playbook

个人蒸馏的逻辑是 **秒→任务→小时→天→周**，从原始行为涌现个人 Playbook。

同样的递归往上走一层：多个人的个人 Playbook 执行记录，是组织级蒸馏的"原始行为"。**个人蒸馏看一个人反复怎么做，组织蒸馏看一群人协作时反复怎么流转。**

### 递归同构

```
个人蒸馏                          组织蒸馏
──────────────────────────────────────────────────────
原始输入：Screenpipe 屏幕事件      原始输入：各人 agent 的执行记录
                                    "张三 agent 10:00 完成数据分析，产出物发给王五"
                                    "王五 agent 14:00 完成方案草稿，发给李四审"
                                    "李四 15:30 手动改了三处条款，退回王五"

信号过滤：转折点 / 回避 / 压力     信号过滤：流转异常 / 角色跳过 / 瓶颈

秒级 → 微操特征                    （无对应，个人级已处理）
任务级 → 方法论                    任务级 → 一个跨人任务的完整流转路径
小时级 → 节奏                      （无对应）
天级 → 决策风格                    周级 → 一周内所有跨人任务的模式聚合
周级 → 个人 Playbook               月级 → 组织 Playbook
```

### 组织蒸馏的输入

个人蒸馏从 Screenpipe 读原始事件。组织蒸馏从**执行层的流转记录**读事件：

```
每次跨人协作产生一条流转记录：

{
  "task": "新客户合作方案",
  "initiated_by": "张三",
  "timestamp": "2026-03-11T09:00:00",
  "steps": [
    {
      "role": "data-analysis",
      "assignee": "赵六",
      "started": "09:15", "completed": "11:30",
      "mode": "auto",          ← agent 全自动完成
      "output": "client-data-report.xlsx"
    },
    {
      "role": "competitor-research",
      "assignee": "王五",
      "started": "09:15", "completed": "13:00",  ← 和上一步并行
      "mode": "assisted",      ← agent 草拟，王五修改后确认
      "output": "competitor-comparison.md"
    },
    {
      "role": "proposal-writing",
      "assignee": "王五",
      "started": "14:00", "completed": "16:30",
      "mode": "assisted",
      "output": "proposal-v1.docx",
      "depends_on": ["data-analysis", "competitor-research"]
    },
    {
      "role": "legal-review",
      "assignee": "李四",
      "started": "16:45", "completed": "17:30",
      "mode": "manual",        ← 李四完全手动做的
      "output": "proposal-v1-reviewed.docx",
      "corrections": 3          ← 改了 3 处
    },
    {
      "role": "revision",
      "assignee": "王五",
      "started": "17:30", "completed": "18:00",
      "mode": "auto",           ← agent 按李四的批注自动改
      "output": "proposal-v2.docx"
    }
  ],
  "total_duration": "9h",
  "outcome": "sent_to_client"
}
```

### 组织信号过滤

和个人级的转折点 / 回避 / 压力检测递归对应：

```
流转异常（对应个人"转折点"）：
  这次方案没经过法务审查就发了 → 为什么跳过了？
  这次数据分析不是赵六做的，是张三自己做的 → 为什么换人了？
  王五的方案被退回了 2 次（通常只退 0-1 次）→ 质量问题还是需求变了？

角色跳过（对应个人"回避模式"）：
  有法务角色但这类任务从来不走法务 → 团队习惯性跳过法务审查
  有数据分析角色但张三总自己做 → 张三不信任赵六的分析？还是沟通成本太高？

瓶颈检测（对应个人"压力标记"）：
  李四的法务审查总是卡 1-2 天 → 所有任务的瓶颈都在同一个人
  王五同时被分配了 3 个方案撰写 → 负载不均
  某类任务的平均耗时越来越长 → 流程在退化
```

### 组织 Playbook 格式

和个人 Playbook 格式递归同构——情境-行动对。只是"行动"不是一个人做什么，而是**哪些角色按什么顺序做什么**：

```markdown
# org-playbook/client-proposal.md（涌现的，不是预设的）

## 情境：老客户续约方案
角色：data-analysis(≥0.8) → proposal-writing(≥0.85) → pricing-approval(≥0.7)
流转：数据分析(1天) → 方案撰写(1天) → 内部定价审批(0.5天) → 发送
通常耗时：2.5 天
置信度：0.9（做过 11 次）

## 情境：新客户首次方案
角色：+competitor-research(≥0.7) + legal-review(≥0.85)
流转：竞品调研 ∥ 数据分析(各1天) → 方案撰写(2天) → 法务审查(1天) → 内部评审(0.5天) → 发送
通常耗时：5.5 天
置信度：0.85（做过 7 次）
注意：比老客户多法务环节——新客户合同没有历史模板

## 情境：紧急方案（≤3天）
角色：同"新客户"但跳过 legal-review
流转：数据分析 ∥ 竞品调研(1天) → 方案撰写(1天) → 跳过法务 → 发送
置信度：0.7（做过 3 次）
注意：压力下跳过法务审查 ← 和个人压力标记同一个逻辑
风险标记：3 次中有 1 次事后被客户法务退回要求补条款

## 底层组织价值观
→ 续约流程精简（信任关系已建立）
→ 新客户流程完整（防御性高）
→ 紧急时牺牲法务环节（速度 > 合规，但有后果）

## 反例
2026-02-28 老客户续约也走了法务审查
→ 边界条件：合同金额比往常大 3 倍
→ evidence: org-task-20260228-001
```

### 角色 ≠ 岗位，角色 = 能力标签

角色从个人 Playbook 自动映射，不是 HR 录入的：

```
张三有 playbook/data-analysis.md (0.95)
  → 张三可以填 data-analysis 角色

王五有 playbook/competitor-research.md (0.88)
  和 playbook/proposal-writing.md (0.91)
  → 王五可以填两个角色

李四有 playbook/contract-review.md (0.93)
  → 映射到组织角色 legal-review

capability-map.json（自动生成）：
{
  "data-analysis":       [{"user": "赵六", "confidence": 0.95},
                          {"user": "张三", "confidence": 0.82}],
  "proposal-writing":    [{"user": "王五", "confidence": 0.91}],
  "competitor-research": [{"user": "王五", "confidence": 0.88},
                          {"user": "张三", "confidence": 0.65}],
  "legal-review":        [{"user": "李四", "confidence": 0.93}],
  "pricing-approval":    [{"user": "张三", "confidence": 0.91}]
}

→ 一个人可以填多个角色
→ 一个角色可以由多个人填
→ 匹配时看 confidence 门槛 + 当前负载
→ legal-review 只有李四一个人 → 组织能力缺口，自动标记（Ashby：该角色多样性不足）
```

### 组织记忆系统（递归同构）

```
standmeet-memory/
├── users/
│   ├── zhangsan/
│   │   ├── playbook/           ← 个人 Playbook
│   │   ├── identity/
│   │   ├── episodes/
│   │   └── meta/
│   ├── lisi/ ...
│   └── wangwu/ ...
│
└── org/                         ← 组织级（同构）
    ├── playbook/                ← 组织 Playbook（协作流转模式，涌现）
    │   └── client-proposal.md, incident-response.md, ...
    ├── identity/                ← 组织 Identity（团队文化/风格）
    │   ├── values.md             ← "偏保守，多审查" / "偏快，先发再改"
    │   └── rhythm.md             ← "周一规划，周五发布"
    ├── episodes/                ← 组织级协作记录
    │   └── raw/
    │       └── 2026-03-11.jsonl  ← 每条是一次跨人任务的完整流转
    ├── meta/
    │   ├── confidence.json       ← 每个协作模式的置信度
    │   ├── gaps.jsonl            ← 流转异常（"这次为什么跳过了法务？"）
    │   ├── capability-map.json   ← 角色 → 人员映射（从个人 Playbook 聚合）
    │   └── staleness.json        ← 协作模式的新鲜度
    └── context/
```

### 组织记忆固化（递归同构）

```
组织 episodes 的固化策略和个人级相同：
  0-30 天：全留
  30-90 天：被检索过的保留，已吸收进 org-playbook 的清理
  90 天+：压缩版也没被检索 → 删除

稳态 ≈ 500-1,000 条（组织级任务频率比个人低）

组织 Playbook 的 confidence 衰减：
  "上次用这个流程是 3 个月前" → staleness 标记
  → 人员可能变了、工具可能变了、流程实际已经变了
  → 下次触发时降回"建议模式"重新验证
```

### 组织级主动提问（递归同构）

个人级问用户"你为什么这么做"。组织级问**"这次流转为什么和通常不一样"**：

```
org/meta/gaps.jsonl：
{
  "observed": "新客户方案跳过了法务审查",
  "usual_pattern": "新客户方案都经过 legal-review",
  "gap": "是紧急跳过，还是流程变了？",
  "ask_who": "张三",     ← 问发起人
  "priority": 0.9
}

{
  "observed": "数据分析由张三做了，不是赵六",
  "usual_pattern": "data-analysis 角色通常由赵六(0.95)填充",
  "gap": "赵六不在？还是这个任务有特殊要求？",
  "ask_who": "张三",
  "priority": 0.6
}

回答整合路径和个人级相同：
  → 写入 org/episodes
  → 尝试更新 org-playbook（追加情境分支）
  → 可能发现新的边界条件
```

### 任务进来时的完整流程

```
1. 任务输入
   "客户 ABC 要求下周一前出一版新的合作方案"

2. 查组织 Playbook
   org-playbook/client-proposal.md
   → 匹配情境："新客户首次方案"
   → 需要角色：data-analysis + competitor-research + proposal-writing
               + legal-review + pricing-approval
   → 通常流转：竞品 ∥ 数据(1天) → 方案(2天) → 法务(1天) → 审批(0.5天)
   → 但只有 4 个工作日 → 触发情境："紧急方案" → 并行更多步骤

3. 查 capability-map.json → 匹配人
   data-analysis → 赵六(0.95) 或 张三(0.82)
   → 赵六当前负载：已有 2 个任务 → 分给张三
   competitor-research → 王五(0.88)
   proposal-writing → 王五(0.91)
   legal-review → 李四(0.93) → 只有他一个人，不可替代
   pricing-approval → 张三(0.91)

4. 生成流转计划（建议模式，因为是紧急情境 confidence 0.7）
   Day 1: 张三(数据) ∥ 王五(竞品)     ← 并行
   Day 2: 王五(方案)                    ← 依赖前两步
   Day 3: 李四(法务) + 张三(定价审批)   ← 法务和定价可并行
   Day 4: 修改 + 发送                   ← buffer

5. 发起人（张三）确认计划
   → 各人的 agent 收到子任务
   → 按各自的个人 Playbook 执行
   → 产出物自动流转到下一环节

6. 流转完成 → 写入 org/episodes → 组织蒸馏输入
```

### 组织级蒸馏管线

```
任务级（每次跨人协作完成后）：
  Haiku 做流转摘要
  "新客户方案，4 天完成，走了数据+竞品+方案+法务+审批全流程"
  ~$0.001/次，一天 2-3 次 ≈ $0.003/天

周级（每周）：
  Sonnet 聚合本周所有跨人任务
  对比 org-playbook → 发现偏差 → 更新或新建条目
  ~$0.03/周 ≈ $0.004/天

月级（每月）：
  Opus 做组织深度分析
  更新 org/identity/（团队文化是否在变？）
  发现能力缺口趋势（哪些角色越来越紧张？）
  ~$0.50/月 ≈ $0.02/天

组织蒸馏总计：~$0.03/天/团队（不是每人）
```

### 数据隔离

```
个人 Playbook 的原始内容 → 永远在员工本地
组织 Playbook 看到的 → 只有角色标签 + confidence 数值 + 流转时间

org-playbook 知道：
  ✅ "data-analysis 角色通常需要 1 天"
  ✅ "赵六的 data-analysis confidence 是 0.95"
  ✅ "这次法务审查改了 3 处"

org-playbook 不知道：
  ❌ 赵六具体查了什么数据
  ❌ 李四改了哪三处条款
  ❌ 王五的方案里写了什么

除非员工明确授权共享 Playbook 内容（如"最佳实践分享"场景）
```

（产品拆分和定价见 protocol-architecture.md）
