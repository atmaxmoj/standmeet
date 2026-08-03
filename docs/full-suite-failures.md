# 全量 e2e 失败定位 —— 2026-08-02 轮（1168 passed / 14 failed / 3 did not run / 2 skipped，1.3h）

> 上一轮（1052 passed / 7 failed）的定位记录在 git 历史里（本文件按轮重写）。

归档现场：`e2e/test-results-archive/20260802T192837Z/`（14 个 case dir + backend.log）。
诊断**只读归档**（error-context + backend.log + 代码 + git 历史），不重跑、不裸 docker。
**没有 "pre-existing" 豁免 —— 17 条全要修绿。**

> 「3 did not run」不是被砍，是同文件 `beforeAll` 挂掉后剩下的用例没机会跑：
> `wiki-list-navigation:75`、`wiki-list-navigation:93`、`wiki-tree-scale:67`。命运绑在 Batch C。

---

## Batch A — golden 快照过期｜2 条

| # | spec | error（读日志） | 根因（证） | 修 |
|---|------|----------------|-----------|----|
| 7 | norm-outward-handles | `toEqual` 差 `writings.bundle`（Expected −5 / Received +0） | `writings.bundle` 定义在 `internal/owner/ownercore/cap_writings.go:21`，随 ownercore 在 **commit d3b57ebe** 一并删除（`git show d3b57ebe --stat`）。golden 自己的注释早预言「那笔债还清，这份 golden 就只剩 jobs 插件那三条」。 | ✅ 去掉该项；注释同步纠正（原写的理由「字节流进不了一个 JSON op」本身是错的） |
| 8 | norm-outward-toolset | `toEqual` 多出 `"assets.upload"`（Expected −0 / Received +1） | 本刀新增的 MCP 工具（`internal/corpus/ops/assets.go`），golden 未同步。 | ✅ golden 加入 `assets.upload` + 说明 |

**状态：已修，待 REPEAT=5。**

---

## Batch B — 连接器域错误在搬进收口时丢了分类，全落 500｜6 条

**根因（证）**：backend.log
`{"msg":"dispatcher op failed","op":"connectors.delete","err":"delete connector: built-in connector is read-only"}`
紧跟 `{"path":"/api/admin/connectors/google-calendar","status":500}`。

`internal/connector/svc_errors.go` **刻意**把失败分成 `ErrNotFound / ErrBuiltinReadonly / ErrInvalidManifest /
ErrConnectionFailed / ErrNoOAuthClient`（注释原话：「分得开才不会把…混成一个含糊错」）。翻译原本在 admin
手写路由 `routes/admin/connectors_errors.go` 的 `writeConnErr`；操作搬进收口（`cmd/server/axisconn`）后
**没人再翻** —— `connectorIDAction` / `createConnector` / `updateConnector` 一律 `fp.OpErr(...)` → 未分类 → 500。
owner 删一个内置连接器，产品告诉他「服务器错误」，真相是「这个连接器不能删」。

| # | spec | 期望 → 实际 |
|---|------|------------|
| 1 | connector-binding-jsonata：坏 JSONata | `<500` → 500 |
| 2 | connector-binding-jsonata：operationId 不在 spec 里 | `<500` → 500 |
| 3 | connector-binding-jsonata：未知 category | `<500` → 500 |
| 4 | connector-binding-jsonata：contract op 未映射 | `<500` → 500 |
| 5 | connector-security：SSRF 内网 spec URL | `<500` → 500（err 含 `egress target is an internal/private address`，包在 `ErrInvalidManifest` 下） |
| 6 | connector-upload-mgmt：删内置 → 409 `builtin_readonly` | 409 → 500 |

**修**：✅ 新建 `cmd/server/axisconn/errors.go` 的 `connErr(what, err)` —— 域 sentinel → fp 分类错
（`ErrBuiltinReadonly` → `Coded(Conflict, "builtin_readonly")`；`ErrInvalidManifest` →
`Coded(BadInput(err.Error()), "invalid_manifest")` 带具体原因；其余 NotFound / BadInput）。
翻译**跟着操作一起搬**：域声明自己的 op，也声明自己的失败长什么样。五个写 op 全接。

**状态：已修，待 REPEAT=5。**

---

## Batch C — `beforeAll` 30s 预算 < 播种真实耗时｜3 条（+3 连累）

**根因（证）**：从 backend.log 数出来，不是估的。
`navtree` 播种窗口 `19:23:44.477 → 19:24:11.004`：**136 次 `/mcp` 串行往返，墙钟 27.0 s**
（服务端合计 12 080 ms = 89 ms/次；每次往返 200 ms，其余约 111 ms 是逐次 HTTP + JSON-RPC 客户端开销）。
`beforeAll` 预算 **30 000 ms**，播种独吞 27 s，再加 claim + login + role + code → 必然溢出。

播种形状（`wiki-list-navigation.spec.ts:126 seedTree`）：4 + `WIDE_COUNT`(60) 个节点，
每节点 = `corpus.create(raw)` + `corpus.promote` 两次往返 = 128 次，加装配共 136 次。

| # | spec | 连累 |
|---|------|------|
| 12 | wiki-list-navigation:54 | :75 / :93 未跑 |
| 13 | wiki-retrieval-scale:51 | — |
| 14 | wiki-tree-scale:59 | :67 未跑 |

**修**：给这三个 `beforeAll` 与工作量相称的预算。
**不并发化播种** —— 这三条断言的正是「第 51 条往后不能消失」，候选集按 `created_at` 排序，
并发会打乱种入顺序，等于改掉被测的前提。

**状态：待修。**

---

## Batch D — `show_as_source` 在两个写口上被静默丢弃｜1 条（同族两个洞）

| # | spec | error |
|---|------|------|
| 10 | visitor-chat-hidden-source | `cited` = `[meta/persona, projects/lucerna]`，断言 `.not.toContain('meta/persona')` 失败 |

**根因（证）**：
1. 播种（`e2e/fixtures/corpus.ts:51`）把 `show_as_source: false` 传给 **`corpus.promote`**。
2. `ops/corpus_write.go` 的 `promoteByGenre` 组 `usecase.PromoteInput` 时**没有这个字段**
   （`corpus.go:70` 的 `PromoteInput` 只有 OwnerID/RawID/ParentID/Title/Tags），
   `corpusPromoteSchema` 里也没有 → **参数被静默丢弃** → meta/persona 建出来是 `show_as_source=true`
   → 进 cited → 断言炸。
3. 同族第二个洞：genre 参数化之前（`ownercore/cap_corpus_mutations.go:141`）语义是
   `ShowAsSource: args.ShowAsSource == nil || *args.ShowAsSource` —— **nil = true**。
   参数化（commit `aeff264a`）把它变成 `corpusWriteArgs.ShowAsSource` 这个**裸 bool**，
   于是 `corpus.update` **不带该字段就会把条目藏起来**。契约在重构里丢了，编译不报。

**修**：待写 —— `corpusWriteArgs.ShowAsSource` 改 `*bool`（nil = true，恢复旧契约）；
promote 转发它（schema + `PromoteInput` / `PromoteToOutputInput` + 两条 promote 路径）。
**不是点修**：让「写口收到的字段要么生效、要么明确拒绝」，静默丢弃这条路堵死。

**状态：待修。**

---

## Batch E — 根因未证，需要先补日志｜2 条

SOP 第 4 条：找不到根因就**先承认找不到，再加日志**，不许拿结构性猜想充数。

| # | spec | error | 目前只知道（读归档，非推断） |
|---|------|------|--------------------------|
| 9 | real-third-party-mcp-network | `Test timeout of 30000ms exceeded` | 页面快照已进会话（`invited · NET-00E7`，1/50 turns）→ 会话建立成功，卡在这一轮内部 |
| 11 | visitor-same-name-continue | `page.waitForResponse` 15s 超时 | 页面快照停在**身份选择器**（"Who's reading?"），即 START 之前 → 等的那个 response 根本没发出去 |

### 调查记录（为**抓日志**重跑，非"看是否变绿"）

归档 backend.log 里**没有测试名标记**，无法把某个时间窗归给具体 spec —— 这是这一批卡住的直接原因，
不是懒得查。于是各单跑一次，拿一段已知时间窗的日志。

**已证的事实（与 spec 归属无关，本身就是缺陷）**：全量里 `POST /api/v1/sessions` 共
537×200 / 37×401 / 5×403 / 35×429，而 **35 次 429 全部挤在 18:58:52–18:58:56 这 4 秒内**，
形状是：

```
POST /api/admin/codes 201        ← 刚建完一张码
POST /api/v1/sessions 401  ×10   ← 同一秒内连打 10 次
POST /api/v1/sessions 429  ×15   ← 限流器开始拦
…4 秒后…
POST /api/v1/sessions 200        ← 才成功
```

**401 是因，429 是果**（限流器在拦一个重试风暴）。发起方是**浏览器**（UA=Mozilla，非 node/curl），
4 秒 30 次 —— 不是人的节奏。

**已排除**：`lib/gate/use-issue-pending-code.ts:118` 对 401 是**显式处理**的（丢掉 pending、
隐藏 picker、回落 public），没有重试循环。所以那 30 次不是名字选择器这条路径发的。**发起方仍未定位。**

**单跑结果（不作为根因结论）**：
- E1 `visitor-same-name-continue`：2 passed，窗口内 `/api/v1/sessions` **仅 2 次调用、全 200** —— 401 风暴不复现。
- E2 `real-third-party-mcp-network`：**单跑就红（1 failed / 1 passed）→ 确定性失败，不是负载相关。**

**E2 已证的事实**（本次单跑的后端日志 + 新 error-context）：

```
agent turn start  … mode=code tools:13
agent tool done   name=netfetch_fetch    result_bytes=43   ← AllowNet 那条:工具真跑了
agent turn done   dur_ms=89
agent turn start  … mode=code tools:13
agent tool done   name=cagedfetch_fetch  result_bytes=43   ← 断网那条(它的用例是 passed)
```

工具**执行成功**（沙箱 AllowNet 生效，13 个工具都在），失败在**最终回答**：页面上那条
`ai` 消息的正文不是注册的 `'fetched it'`，而是**整份 system prompt 被当成答案渲染出来**
（"[system:You are answering visitor questions on behalf of the owner…" 一路到 ask_visitor 的
工具说明）。断言找 `PAYLOAD_MARKER` 自然找不到。

用户消息里两个注册标签都在（`[[s:c1893…-0]] [[s:c1893…-1]]`），而 `-0`（工具调用）**确实生效了**
—— 日志里工具跑了。所以问题出在 `-1`（回复文本）那一条：mock 没有返回注册的回复，而是回退成
**回显请求**，请求里含 system prompt → prompt 进了答案。

**更正（我先前判断错了两次，都记在这里）**：
- 回答里出现整份 system prompt **不是泄漏，是 mock 的设计行为** —— `llm-gateway/messages.go`
  的 `composeFinalReply` 故意 echo「system prompt + 每个 `[skill_result:…]`」，好让 e2e 能断言
  prompt 组装和沙箱结果。注册**命中了**，不是没命中。
- 所以该看的不是 mock 的标签匹配，是那个被 echo 出来的工具结果。

**真根因（证）**：error-context 里的回显是

```
[skill_result:[error] [Errno 2] No such file or directory]
```

`netfetch_fetch` 和 `cagedfetch_fetch` **都**返回这 43 字节的同一个错误（日志两处 `result_bytes=43`）。
`[Errno 2]` 是 **Python** 抛的 OSError → 解释器起来了，之后才开不到某个文件；而在沙箱**外**
`PYTHONPATH=/srv/plugins/fetch/pkg python -m mcp_server_fetch --help` 正常。
⇒ **失败发生在 bwrap 内**，是沙箱挂载 / 运行时缺件，与本刀的改动无关
（同族：[[prod-sandbox-bwrap-gap]] / F-A-1 的三层部署缺口）。

**顺带暴露一条假绿**：同 spec 的另一条用例「default `--network=none`：同样的 fetch 被拒」
**passed** —— 但它通过的原因是插件**根本没跑起来**（同一个 ENOENT），不是网络隔离生效。
一个「断网应当失败」的断言，在「一切都坏了」时同样成立。这条用例需要区分
「被网络隔离拒绝」和「插件没起来」，否则它守不住它声称守的东西。

**根因（实证复现，非推断）—— 是本轮我自己引入的回归**：

```
$ docker exec …backend sh -c 'SSL_CERT_FILE=/nonexistent/bundle.crt python -c "
    import httpx; httpx.get(\"http://payload-origin:7070/payload.txt\")"'
ERR: FileNotFoundError [Errno 2] No such file or directory      ← 与失败用例逐字相同
```

链路：genre-assets 要求 https 图床 → 我给 external-mock 加了自签证书，并给**后端容器**设
`SSL_CERT_FILE=/mock-tls/bundle.crt`（docker-compose.dev.yml）→ `mcpclient.DialStdio` 在
`os.Environ()` 之上追加 env，**沙箱子进程继承了它** → 沙箱**没有** bind `/mock-tls` →
python 的 ssl 层**急切地**打开该文件，连纯 http 请求也不例外 → 所有 python 沙箱插件当场全灭。

症状伪装得很好：错误里**既不提 TLS 也不提那个路径**，只说"没有那个文件"，于是它看起来像
"网络被拒"。我因此先后误判成「负载相关」和「mock 泄 system prompt」两次，直到去复现那一行。

**修**：✅ `internal/capabilities/sandbox/stdio.go` 的 `baseBwrapArgv()` 加
`--unsetenv SSL_CERT_FILE --unsetenv SSL_CERT_DIR`。**不是绕过,是把边界补上** ——
沙箱本来就自己 bind 了 `/etc/ssl` + `/etc/ca-certificates`(`netBinds`),信任材料是沙箱自己的事;
继承一个宿主路径,在沙箱里只可能是"不存在"或"误导"。

**REPEAT=5：10/10 绿。**

**结论**：这两条的失败是**负载相关**的，隔离状态下观察不到，因此**最终全量是唯一能观察它们的地方**。
若最终全量再红，会拿到带已知窗口的新归档继续定位；**不把"单跑绿"当作修好了**。

**待办（与本轮是否复现无关的真缺陷）**：定位那个以 ~10 次/秒重试的浏览器端调用方并给它上界 ——
一个访客只要遇到 401，我们的页面就会捶自己的后端直到被自己的限流器拦下。

---

## 收尾规则（SOP）

- 每个 batch 修完，`make test-only SPEC="<spec>" REPEAT=5` 全绿才算 done。
- **全量重跑只在所有 batch 都 repeat-5 绿之后跑一次。**
