# OpenClaw 的传播机制：一个传播学视角的拆解

## Abstract

OpenClaw 60 天 250k+ stars。本文不讨论"它为什么好"，而是用传播学理论框架分析"它为什么传开了"——从创新扩散、二级传播、框架效应、社会认同到争议动力学，逐层拆解每个增长阶段背后的传播机制。

---

## 增长时间线（供后文引用）

| 阶段 | 时间 | Stars | 关键事件 |
|------|------|-------|---------|
| 萌芽期 | 2025.11 | ~几百 | Clawdbot 发布 |
| 争议期 | 2025.12 | ~数千 | Anthropic 商标争议，改名 Moltbot |
| 更名期 | 2026.01 | ~9,000 | 定名 OpenClaw，密集开发 |
| 爆发期 | 2026.02 | 9k→210k | 10 天涨 200k |
| 媒体期 | 2026.02-03 | 210k→250k | TechCrunch, Lex Fridman, Fortune |
| 稳态期 | 2026.03- | 270k+ | 超越 React，安全危机 |

---

## 一、创新扩散理论（Rogers, 1962）

Everett Rogers 的创新扩散理论说，一个创新能否被采纳取决于五个属性。逐一对照：

### 1. 相对优势（Relative Advantage）

```
现有方案：              OpenClaw：
ChatGPT → 数据在云端    → 数据在本地
Ollama → 只能聊天       → 能执行操作
Siri → 不可定制         → 完全开源
LangChain → 要写代码     → npm install 就行
```

相对优势不在于单点突破，在于**多维同时优于**。Rogers 说相对优势越大，采纳越快。OpenClaw 对每个竞品都有不同维度的优势，所以对每个竞品的用户群都有吸引力——扩大了潜在采纳者的总池子。

### 2. 兼容性（Compatibility）

这是 OpenClaw 最被低估的传播属性。

> **它不要求你改变任何现有行为。**

你用 Telegram？它就在你的 Telegram 里。你用 Discord？它就在你的 Discord 里。你用 WhatsApp？同样。

Rogers 定义兼容性为"与采纳者的现有价值观、过往经验和当前需求的一致程度"。OpenClaw 的 24 个 channel 支持不是功能特性——**是传播学意义上的兼容性最大化**。

对比需要你下载新 app、注册新账号、学新界面的 AI 工具，OpenClaw 的采纳成本接近零。你不需要改变任何习惯，只需要在你已经用的工具里多加一个联系人。

### 3. 复杂性（Complexity）—— 反向

```bash
npm install -g openclaw@latest
openclaw onboard --install-daemon
```

两条命令。交互式 wizard 引导配置。5 分钟内完成第一次对话。

Rogers 说复杂性与采纳率成反比。OpenClaw 把 self-hosted AI 的复杂性从"需要配 Docker + 数据库 + 反向代理 + SSL"降到了"两条命令"。

### 4. 可试性（Trialability）

装完后 `http://127.0.0.1:18789` 直接在浏览器里聊。不需要配置任何 channel。

**零配置试用 → 看到价值 → 再决定要不要接入 Telegram/Discord。**

Rogers 说可试性越高、试错成本越低，采纳越快。WebChat 作为零门槛入口，是产品设计服务于可试性的典型案例。

### 5. 可观察性（Observability）

这是 OpenClaw 传播最精妙的地方。

传统开发工具的问题是**使用过程不可见**——你用了一个好的 ORM，别人看不到。但 OpenClaw 的使用场景天然可见：

- 你在 Telegram 群聊里问你的 AI，群里其他人看得到
- 你截图你的 AI 在 WhatsApp 里回复你，发到 Twitter
- 你在 Discord server 里展示你的 AI 技能，server 成员看得到

**24 个 channel 的每一个都是可观察性的放大器。** 用户的日常使用行为本身就是展示行为。这和 Hotmail 在每封邮件底部加"Get your free email at Hotmail"是同一个机制——产品的使用即传播。

### Rogers 的 S 曲线预测

Rogers 模型预测创新扩散遵循 S 曲线：缓慢起步 → 起飞 → 快速增长 → 饱和。

```
Stars
270k ─────────────────────────────── ·····→
       │                           ╱
210k ─ │                         ╱   ← 媒体期（TechCrunch/Lex Fridman 推动晚期多数）
       │                       ╱
       │                     ╱       ← 爆发期（GitHub Trending 触发从众效应）
 60k ─ │                   ╱
       │                 ╱
  9k ─ │            ···╱             ← 更名期（品牌确立，早期多数开始关注）
       │        ···
  ~0 ─ │····                         ← 萌芽期 + 争议期（创新者 + 早期采纳者）
       └──────────────────────────
       11月  12月  1月   2月    3月
```

OpenClaw 的 S 曲线异常陡峭——从萌芽到起飞只花了约 3 个月。典型开源项目这个阶段需要 1-3 年（React 用了约 2 年，Docker 用了约 1 年）。

原因不只是产品好。下面的理论框架会解释为什么曲线这么陡。

---

## 二、二级传播与意见领袖（Katz & Lazarsfeld, 1955）

### 传统的二级传播模型

```
大众媒体 → 意见领袖 → 普通受众
```

Katz & Lazarsfeld 在 1955 年提出：信息不是直接从媒体流向大众，而是先到达"意见领袖"（opinion leaders），再由他们影响周围的人。

### OpenClaw 的传播实际上是三级的

```
第一级：Peter 的个人网络
   Peter（PSPDFKit 创始人，iOS 社区 KOL）
      → 他的 Twitter 粉丝（高质量开发者）
      → iOS/macOS 开发者社区

第二级：开发者意见领袖扩散
   早期采纳的开发者
      → 写博客分析（Medium 上的技术文章）
      → 在自己的 Discord server / Telegram 群分享
      → 提 PR 后发推感谢

第三级：大众媒体放大
   TechCrunch / Fortune / Lex Fridman / 36kr
      → 非开发者技术爱好者
      → 投资人、产品经理、创业者
      → "听说过但不一定会用"的泛科技人群
```

**关键洞察：Peter 本人就是第一级的意见领袖。**

Lazarsfeld 定义意见领袖的特征是：(1) 在某领域被认为有专业能力，(2) 社交活跃，(3) 主动传播信息。Peter 作为 PSPDFKit 创始人，在 iOS 开发社区完全符合这三条。

这意味着 OpenClaw 跳过了大多数开源项目的冷启动困境——不需要等大众媒体注意到你，创始人本身就是分发渠道。

### 意见领袖密度与传播速度

530 个贡献者在 3 周内加入。开源项目的贡献者通常是更广泛用户群中最活跃的 1-5%。按 2% 估算，530 个贡献者意味着约 26,500 个活跃用户。

这些贡献者中有多少是各自社区里的意见领袖？开源贡献者本身就具备 Lazarsfeld 定义的意见领袖特征——他们技术能力强、社交活跃（活跃在 GitHub）、主动传播（提 PR 本身就是传播行为）。

**每个贡献者都是一个二级传播的节点。530 个节点在 3 周内同时激活，传播速度指数级增长。**

---

## 三、框架效应与议程设置（Entman, 1993; McCombs & Shaw, 1972）

### OpenClaw 的框架（Frame）不是"又一个 AI 工具"

Entman 定义框架为"选择感知到的现实的某些方面，使其在传播文本中更加突出"。OpenClaw 的传播框架经历了三次重构：

**框架 1：萌芽期——"个人 AI 助手"**
```
核心叙事：你可以拥有自己的 AI 助手，在你自己的设备上
强调的方面：隐私、本地化、自主权
省略的方面：技术复杂性、需要 API key、需要服务器
```

**框架 2：爆发期——"vibe coding 的产物"**
```
核心叙事：一个人用 AI 写了一个比大团队项目还大的项目
强调的方面：Peter 的工作方式、AI 辅助开发的可能性
省略的方面：Peter 的十年工程经验、PSPDFKit 背景
```

**框架 3：媒体期——"AI 时代的新范式"**
```
核心叙事：一个奥地利开发者做了个项目超过 React，被 OpenAI 雇了
强调的方面：star 数字、超过 React 的叙事张力、个人英雄主义
省略的方面：安全问题、可持续性疑问、实际用户留存率
```

### 议程设置的层级

McCombs & Shaw 的议程设置理论分两层：
- **第一层**：媒体告诉你"该关注什么"（OpenClaw 存在且值得关注）
- **第二层**：媒体告诉你"该怎么想"（OpenClaw = 个人开发者的胜利 / AI 时代的标志）

每一波媒体报道都在做议程设置：

| 媒体 | 第一层（关注什么） | 第二层（怎么想） |
|------|-----------------|----------------|
| TechCrunch | OpenClaw 存在 | Peter 是值得学习的 builder |
| Fortune | Peter 被 OpenAI 雇用 | 他一定很厉害 → 项目一定好 |
| Lex Fridman | AI 开发的哲学 | "Vibe coding 是 slur"——这是严肃工程 |
| 36kr | OpenClaw 进入中国视野 | 80% 的 app 会消失 |

**每个媒体都在用自己的框架重新包装 OpenClaw 的故事，但都在做同一件事——把 OpenClaw 放进公众议程。**

---

## 四、社会认同与从众（Cialdini, 1984）

### GitHub Star 的社会认同级联

Cialdini 的社会认同原则（Social Proof）：人们在不确定时会参考他人的行为来决定自己的行为。

GitHub star 是开源世界最直观的社会认同信号。但 star 的传播不是线性的——它是级联的：

```
阶段 1（< 1k stars）
  信号："有人在用"
  采纳者：需要这个功能的人（功能驱动）

阶段 2（1k-10k stars）
  信号："很多人在用"
  采纳者：关注技术趋势的人（趋势驱动）

阶段 3（10k-100k stars）
  信号："你不知道这个就 out 了"
  采纳者：怕错过的人（FOMO 驱动）

阶段 4（> 100k stars）
  信号："这是现象级项目"
  采纳者：非技术人群也开始关注（媒体驱动）
  star 行为本身脱离了使用——很多人 star 了但从没安装过
```

**OpenClaw 从阶段 1 到阶段 4 只花了约 2 个月。** 正常项目在阶段 2 就会卡很久（1k-10k 是最难跨越的区间），因为需要从"功能驱动"转换到"趋势驱动"的受众。

OpenClaw 为什么没卡在阶段 2？因为 Peter 的个人品牌（二级传播的第一级）直接把它推到了阶段 2 的门槛，Anthropic 商标争议（下一节会分析）提供了跨越到阶段 3 的加速度。

### "超过 React"的锚定效应

> "OpenClaw 超过 React 的 star 数了。React 花了 10 年。"

这不是一个技术事实（star 数不等于项目质量），但作为社会认同信号极其有效。Tversky & Kahneman 的锚定效应（Anchoring）：人们在判断时会过度依赖第一个获得的信息。

"超过 React"把 OpenClaw 锚定在了"和 React 同级"的认知位置。之后的所有讨论都在这个锚点上展开——即使是批评者也必须先承认"它确实比 React stars 多"再开始反驳。

---

## 五、争议作为传播动力学

### 商标争议：Streisand 效应的经典案例

```
Clawdbot → Anthropic 说商标侵权 → 改名 Moltbot → 最终定名 OpenClaw
```

从传播学角度，这个争议具备完美的新闻价值要素（Galtung & Ruge, 1965 的新闻价值理论）：

- **冲突性（Conflict）**：小开发者 vs 大公司
- **精英关联（Reference to Elite）**：Anthropic 是 AI 领域的头部公司
- **意外性（Unexpectedness）**：一个 side project 引起大公司注意
- **叙事性（Narrative）**：David vs Goliath 的故事模板

**争议本身比项目更有传播力。** 很多人是因为"Anthropic 让一个开源项目改名"才知道 OpenClaw 的，而不是因为 OpenClaw 的功能。

这是经典的 Streisand 效应——试图压制信息的行为反而放大了传播。Anthropic 可能从未想过要"压制"什么，但公众的感知是"大公司欺负小开发者"，这个叙事极具传播力。

### "Vibe coding 是一个 slur"：争议声明的传播动力学

Peter 在采访中说 "vibe coding" 这个词是"slur"（贬义词）。

从框架分析角度，这个声明精准地做了三件事：

1. **制造可争论的命题**。不是所有人都同意"vibe coding 是 slur"——有人认为他说得对，有人认为他太敏感。两方都需要转发他的原话才能争论 → 传播。

2. **重新定义自己的工作**。从"vibe coder"到"AI-assisted engineer"，Peter 把自己从一个可能带贬义的品类里抽离出来，放入了一个更有尊严感的框架。

3. **让媒体有标题可写**。"OpenClaw creator says 'vibe coding' has become a slur"（AOL 的实际标题）。争议声明天然具备标题价值。

Noelle-Neumann（1974）的沉默螺旋理论在这里适用：持"vibe coding 是正面的"观点的人被迫要么出来辩护，要么沉默。两种反应都放大了 Peter 的声音——辩护者在传播原始信息，沉默者在让 Peter 的框架成为默认框架。

---

## 六、网络效应与弱连接理论（Granovetter, 1973）

### 24 个 Channel 的网络拓扑意义

Granovetter 的"弱连接的力量"理论说：新信息更可能通过弱连接（acquaintance）而非强连接（close friend）传播，因为强连接的人拥有的信息高度重叠。

OpenClaw 的 24 个 channel 支持在网络拓扑上意味着什么？

```
                    ┌── Telegram 技术群 ──── 俄语圈开发者
                    │
        OpenClaw ───┼── Discord server ──── 游戏/mod 社区
                    │
                    ├── WhatsApp group ──── 非技术用户、家庭群
                    │
                    ├── Slack workspace ──── 企业内部
                    │
                    ├── Feishu ──── 中国企业用户
                    │
                    ├── Line ──── 日本/台湾用户
                    │
                    ├── Zalo ──── 越南用户
                    │
                    └── Matrix ──── 隐私极客社区
```

**每个 channel 连接的是一个不同的社交网络。这些网络之间的连接是"弱连接"。**

一个 Telegram 技术群里的开发者和一个 WhatsApp 家庭群里的用户之间没有直接联系。但 OpenClaw 同时存在于两个网络中，**它自身成为了弱连接的桥梁**。

这在传播效率上的含义：传统工具只在一个网络里传播（比如 Slack-only 工具只在 Slack 用户中传播），OpenClaw 同时在 24 个相对独立的网络中传播。覆盖率不是 24 倍——因为弱连接的信息传播效率远高于强连接内的重复传播，实际效果是指数级的。

### 地理与文化穿透

注意 channel 列表中的非英语市场覆盖：

| Channel | 主要市场 | 传播含义 |
|---------|---------|---------|
| Feishu | 中国 | 绕过了 GitHub 在中国的可见性问题 |
| Line | 日本、台湾、泰国 | 进入东亚非中国市场 |
| Zalo | 越南 | 进入东南亚市场 |
| Nostr | 全球去中心化社区 | 进入 crypto/Web3 社区 |
| IRC | 老派 hacker 社区 | 进入原教旨开源社区 |

**每个 channel 不只是一个技术集成，是一个文化入口。** 36kr 报道 OpenClaw 不是因为 TechCrunch 先报道了——是因为 Feishu 支持让 OpenClaw 直接进入了中国开发者的视野。

---

## 七、叙事传输与神话构建（Barthes, 1957; Green & Brock, 2000）

### Peter Steinberger 的英雄叙事

Roland Barthes 说每个文化现象背后都有"神话"（myth）——不是虚假的故事，而是一种自然化的意识形态。

OpenClaw 背后的神话结构：

```
英雄：    一个奥地利独立开发者（个体 vs 系统）
试炼：    大公司的商标争议（David vs Goliath）
武器：    AI agent（新时代的魔法工具）
成就：    超越 React（量化的胜利）
奖赏：    被 OpenAI 雇用（最终的行业认可）
道德：    一个人 + AI 可以做到一个团队做不到的事
```

这个叙事结构完美契合 Joseph Campbell 的英雄之旅（Hero's Journey）模板。Green & Brock 的叙事传输理论（Narrative Transportation）说：当受众被"传输"进一个叙事中，他们的态度和信念会向叙事方向移动。

**人们不只是在用 OpenClaw——他们在消费一个叙事。** Star 一个项目、转发 Peter 的采访、在自己的项目里效仿他的工作方式——这些行为的动力不完全来自功能需求，很大一部分来自对叙事的认同。

"我也可以像 Peter 一样，一个人用 AI 做出大事"——这是这个神话的核心诱惑。

### 为什么这个叙事在 2026 年有效

Barthes 说神话的功能是"自然化"社会关系。2026 年初的技术文化中有几个焦虑需要被"自然化"：

| 焦虑 | Peter 叙事提供的"解药" |
|------|---------------------|
| "AI 会替代程序员" | → "不会，Peter 证明了人 + AI 的协作模式" |
| "个人开发者没有机会了" | → "不对，Peter 一个人干过了大团队" |
| "开源不赚钱" | → "Peter 被 OpenAI 高薪雇了" |
| "隐私没希望了" | → "你可以在本地跑自己的 AI" |

**OpenClaw 的传播不只是因为它好用，是因为它的存在缓解了一系列社会焦虑。** 每个 star 都是一次小型的焦虑缓解仪式。

---

## 八、(thanks @xxx) 的互惠与认同机制

### 互惠原则（Cialdini, 1984）

Peter 对社区 PR 的处理方式在传播学上值得单独分析。

他不直接 merge PR——他重写代码进 main，在 commit message 里加 `(thanks @username)`。

Cialdini 的互惠原则说：当一个人接受了恩惠，会感到有回报的义务。Peter 的处理方式巧妙地颠倒了互惠方向：

```
传统开源的互惠：
  贡献者给予代码 → 维护者接受 → 维护者欠贡献者（应该给 credit）

Peter 的互惠：
  贡献者提 PR → Peter 重写 + 致谢 → 贡献者感到被重视
  → 贡献者反而欠 Peter（他花了时间重写我的代码 + 公开感谢了我）
  → 贡献者更愿意继续贡献 + 公开宣传
```

`(thanks @xxx)` 不是被动的 credit——是主动的社交礼物。3057 个 commits 中有 223 个带致谢。每个致谢都是一次互惠关系的建立。

### 社会认同与群体归属

`(thanks @xxx)` 还在做另一件事：**构建群体认同**。

被致谢的贡献者形成了一个隐性群体——"被 Peter 感谢的人"。这个群体有清晰的进入条件（提一个被接受的 PR）和可见的标志（commit history 里的 `thanks @` 标记）。

Tajfel & Turner（1979）的社会认同理论说：人们通过群体归属来定义自我。被 OpenClaw 致谢 = 被一个 270k star 项目认可 = 一种身份资本。

**贡献者宣传 OpenClaw 的行为，部分动力来自维护这种身份资本。** "我为 OpenClaw 贡献过代码"在开发者简历里是有价值的，前提是 OpenClaw 继续火。所以贡献者有动力帮助 OpenClaw 继续火。

这是一个自我强化的认同循环。

---

## 九、安全危机的风险传播（Kasperson et al., 1988）

### 风险的社会放大框架（SARF）

Kasperson 等人提出"风险的社会放大框架"：风险事件通过社会过程被放大或缩小，最终的社会影响可能远大于或远小于直接影响。

OpenClaw 的安全危机数据：
- 8 个 critical/high CVE
- 42,665 个暴露实例（93.4% 认证被绕过）
- ~900 个恶意 ClawHub skills（占 registry 20%）

从 SARF 角度分析：

**放大因素**：
- 媒体标题倾向于放大（"Security Nightmare"、"Data Breach Waiting to Happen"）
- 大数字本身就是放大器（42k 暴露实例比"存在安全漏洞"更有冲击力）
- 竞品（IronClaw）利用危机做对比营销，进一步放大风险感知

**缩小因素**：
- 受影响的是技术用户，有能力自行评估风险
- Peter 和社区的修复速度快（符合 OpenClaw 的高迭代节奏）
- "42k 暴露实例"反向证明了用户基数——对潜在用户来说这是社会认同信号
- 开源本身是信任机制——"你可以看代码、自己改"

### 反直觉结论

安全危机对 OpenClaw 的传播效果是**净正的**：

```
直接损失：部分安全敏感用户放弃 → 可能流失了 X 用户
间接收益：
  1. 危机报道本身是免费曝光 → 更多人知道 OpenClaw
  2. IronClaw 等 fork 扩大了生态而不是分裂了用户
  3. "需要修安全问题"刺激了更多贡献者加入
  4. 42k 实例 → 社会认同 → 更多新用户
```

Kasperson 说风险的社会放大可能产生"涟漪效应"（ripple effect），影响范围远超事件本身。OpenClaw 的安全危机确实产生了涟漪——但涟漪的方向是让更多人知道了 OpenClaw。

---

## 十、技术采纳模型（Davis, 1989）

### TAM 的两个核心变量

Fred Davis 的技术采纳模型（Technology Acceptance Model）说，用户是否采纳新技术取决于两个因素：

**感知有用性（Perceived Usefulness）**：用户认为使用这个技术能在多大程度上提升他们的工作表现。

**感知易用性（Perceived Ease of Use）**：用户认为使用这个技术有多容易。

OpenClaw 在两个维度上同时做到了极端值：

| 维度 | OpenClaw 的设计 | 对采纳的影响 |
|------|---------------|-------------|
| 感知有用性 | "在你已经用的 app 里多一个 AI 联系人"——不需要想象使用场景 | 直接映射到现有需求 |
| 感知易用性 | 两条命令安装，wizard 引导，浏览器即用 | 几乎消除了"学习使用"的心理障碍 |

### 版本号作为感知信号

`v2026.3.8` 这个版本格式在 TAM 框架下有特殊意义：

它同时传递了两个感知信号：
1. **感知有用性**：日期版本号暗示"每天都在更新"→ "问题会被快速修复" → "我可以依赖它"
2. **感知易用性**：日期比语义版本号更直观 → "不需要理解 semver 来判断是否应该更新"

---

## 十一、总结：传播机制的叠加效应

OpenClaw 的传播不是单一机制的结果，而是**多个传播机制在不同阶段叠加**的结果。

| 阶段 | 主导传播机制 | 理论框架 |
|------|------------|---------|
| 萌芽期 | Peter 的个人网络辐射 | 二级传播（Katz & Lazarsfeld） |
| 争议期 | 商标争议引爆话题 | 议程设置（McCombs）+ Streisand 效应 |
| 更名期 | 品牌确立 + GitHub Trending | 社会认同级联（Cialdini） |
| 爆发期 | 24 channel 的网络穿透 | 弱连接理论（Granovetter） |
| 媒体期 | 英雄叙事 + 大众媒体放大 | 叙事传输（Green & Brock）+ 框架效应（Entman） |
| 稳态期 | 贡献者认同 + 安全危机涟漪 | 社会认同理论（Tajfel）+ SARF（Kasperson） |

**没有哪个单一因素能解释 60 天 250k stars。** 是这些机制在正确的时间点、以正确的顺序叠加，产生了相变。

### 一个反事实检验

如果去掉每个因素，增长会怎样？

| 去掉什么 | 可能的结果 |
|---------|-----------|
| Peter 的个人品牌 | 卡在 1k-10k stars（无法跨越早期采纳到早期多数的鸿沟） |
| Anthropic 商标争议 | 增长曲线更平缓（少了争议曝光的加速度） |
| 24 个 channel | 传播局限在单一社交网络（可能只在开发者圈子里火） |
| 媒体报道 | 停留在 GitHub Trending 级别（10-50k stars） |
| 安全危机 | 少了一轮免费曝光，但也少了信任损失 → 净效果不确定 |
| AI 辅助的迭代速度 | 飞轮转不起来，PR 处理慢 → 贡献者流失 → 停滞在 50k |

**最不可替代的是 Peter 的个人品牌 + AI 辅助的迭代速度。** 前者提供了冷启动所需的种子用户质量，后者提供了飞轮持续转动的燃料。其他因素是加速器，但没有这两个基础，加速器无处可加。

---

## 对做产品的启发

### 1. Channel 策略不是功能决策，是分发决策

多 channel 支持的 ROI 不应该用"多少用户用了这个 channel"来算，而应该用"这个 channel 为我们打开了哪个之前接触不到的社交网络"来算。接入 Zalo 不是为了越南的 100 个用户——是为了进入一个全新的传播网络。

### 2. 争议是可以被设计的

"Vibe coding 是 slur"不太可能是即兴的——这是一个精确的争议声明，满足传播所需的所有条件（可争论、有立场、有标题价值）。不是说要故意制造争议，而是说：如果争议会来，确保它在你的框架里发生。

### 3. 意见领袖密度 > 用户总量

530 个贡献者（高质量传播节点）比 50,000 个只 star 不用的人更有传播价值。如果你只能选一个指标优化，选"有多少活跃贡献者"而不是"有多少 star"。

### 4. 叙事先行于产品

人们记住的不是 OpenClaw 的功能列表，是"一个人用 AI 做了个超过 React 的项目"的故事。如果你的产品没有一个可以被转述的叙事，它就只能靠功能本身传播——这太慢了。

### 5. 社会认同级联一旦启动就有自己的动力学

一旦过了某个 star 阈值（大约 10k），star 行为就不再完全由产品质量驱动，而是由社会认同驱动。这意味着先发优势极其重要——第一个到 10k 的项目会吃掉后来者的生存空间，因为后来者缺少社会认同信号。

---

Sources:
- [OpenClaw hits 100k GitHub stars](https://www.the180i.com/openclaw-hits-100k-github-stars-and-signals-a-shift-in-how-ai-assistants-are-built/)
- [210,000 GitHub Stars in 10 Days](https://medium.com/@Micheal-Lanham/210-000-github-stars-in-10-days-what-openclaws-architecture-teaches-us-about-building-personal-ai-dae040fab58f)
- [OpenClaw Surpasses React With 250,000 GitHub Stars](https://finance.yahoo.com/news/openclawd-releases-major-platform-openclaw-150000544.html)
- [TechCrunch: OpenClaw creator's advice to AI builders](https://techcrunch.com/2026/02/25/openclaw-creators-advice-to-ai-builders-is-to-be-more-playful-and-allow-yourself-time-to-improve/)
- [Fortune: Who is Peter Steinberger?](https://fortune.com/2026/02/19/openclaw-who-is-peter-steinberger-openai-sam-altman-anthropic-moltbook/)
- [Lex Fridman Interview Analysis](https://medium.com/product-powerhouse/openclaw-peter-steinberger-and-the-5-product-management-lessons-hidden-in-his-lex-fridman-7a12b8e2f146)
- [OpenClaw Security Crisis](https://pbxscience.com/openclaw-2026s-first-major-ai-agent-security-crisis-explained/)
- ["Vibe coding has become a slur"](https://www.aol.com/articles/openclaw-creator-says-vibe-coding-090501774.html)
