# 全量 e2e 失败定位（本轮：1052 passed / 7 failed，49.9min）

诊断只读日志(fullrun.log 的失败块 + 各 spec error-context + 后端代码),不重跑、不裸 docker。
**没有 "pre-existing" 豁免——7 条全要修绿,包括 c3。**

---

## Batch A — 死字段 `message`（该用 `user_message`）｜2 条

| # | spec | error(读日志) | 根因(证) | 修 |
|---|------|--------------|---------|----|
| 2 | connector-booker-handle-no-leak | `booker tool actually executed` 断言失败:body 无 `tool_started/tool_completed` | 该 spec POST `/agent/turn` 用 `data:{conversation_id, message: …${tag}}`,但 `inference/agent_turn.go:53 AgentTurnRequest` **只有 `user_message`(json:"user_message")、没有 `message` 字段** → `message` 被后端丢弃,`user_message` 空 → tag 到不了 mock → 脚本化 `calendar_book` 不触发。旧 mock 内容无关地照发才把这潜伏 bug 藏住了。 | ✅ `message`→`user_message` |
| 3 | connector-dep-revoke-then-gate | `after invalid_grant … disconnected` 断言失败(book 没跑成→状态没翻) | 同上:`postTurn` 里 `message: q` 同一死字段。 | ✅ `message`→`user_message` |

## Batch B — 漏迁的"靠自动检索"spec（throbber / SEARCHED 卡）｜3 条

自动 `corpus_search→corpus_read` 被删后,这 3 条断的不是"引用"(我上一轮的 grep 只抓了 cited/citation,漏了断言 UI 的),而是 throbber / 进度 label / SEARCHED 卡。

| # | spec | error | 根因 | 修 |
|---|------|------|------|----|
| 4 | conversation-toolcalls-survive-reload | `SEARCHED 卡` toBeVisible 失败 | 靠自动 `corpus_search` 出 SEARCHED 卡;mock 纯注册后不再自动搜 | 注册 `corpus_search`(+需要引用则 `corpus_read`),tag 塞消息 |
| 6 | visitor-chat-throbber-label | `progress_label` toBeDefined 失败 | 靠自动 search→read 带 progress label | 注册 `corpus_search`+`corpus_read` |
| 7 | visitor-chat-throbber-reading-dom | `reading <doc>` toBeVisible 失败 | 靠自动 `corpus_read` 显"reading X" throbber | 注册 `corpus_read`(按需带 `[[slow-final:N]]`) |

## Batch C — 迁移暴露了真 gap（hidden-source）｜1 条

| # | spec | error | 根因 | 修 |
|---|------|------|------|----|
| 5 | visitor-chat-hidden-source | `cited` = `[meta/persona, projects/lucerna]`,断言 `.not.toContain('meta/persona')` 失败 | 迁移里给 hidden(`show_as_source=false`)的 wiki 也注册了 `corpus_read` → 被 read → 进 cited。而 `domain/wiki.go:22` 明说"readCollector 不收 show_as_source=false",但 `agent_turn_persist.go collectCitation` 对 **wiki/output 没 gate**(只有 subjectivity 在 dialog 层 gate,见 dialog.go:105)。以前这条从没被读到(自动搜 "lucerna" 不命中 persona),所以 gap 一直没暴露。 | 后端:collectCitation 对 wiki/output 也按 show_as_source gate(需 read 结果带 show_as_source)。**待核实 CorpusEntry/read wire 是否已带该字段。** |

## Batch D — c3-stdio（不许当"已知坏"跳过）｜1 条

| # | spec | error | 根因(证) | 修 |
|---|------|------|---------|----|
| 1 | c3-mcp-client-stdio | `init timeout` | 表象是 init 超时,真因是 SDK 自签 Sigv1 出 401。后端 verifier(`usecases/keypairs.go:161-162`)验的 challenge 是 `standmeet-sigv1\n<keyId>\n<ts>\n<nonce>`,header 要 `nonce=` 字段(replay 防护,`sigv1_nonce.go` Redis SetNX);而 SDK signer(`sdk/packages/mcp-client/src/sigv1.ts`)**签的是 `…\n<keyId>\n<ts>`,漏了 nonce**,header 也没 nonce → 签的字节不同 → `ed25519.Verify` 失败 → 401 → bridge init 超时。e2e fixture signer(`e2e/fixtures/sigv1.ts`,c1 用、绿)早有 nonce;SDK 从没跟上。 | ✅ SDK signer 补 nonce(`randomUUID()`)进 challenge+header,`pnpm -F @standmeet/mcp-client build` 重打 dist(bin 跑 bundled `dist/index.js`)。 |

---

## 状态（第一轮 7 条）
- Batch A: ✅ message→user_message（已 grep,无其他死字段残留）。
- Batch B: ✅ throbber/SEARCHED spec 注册 corpus_search/corpus_read。
- Batch C: ✅ 后端 collectCitation 对 wiki/output 按 show_as_source gate（read wire 带 show_as_source）。
- Batch D: ✅ SDK Sigv1 补 nonce；`make test-only SPEC=c3-mcp-client-stdio REPEAT=5` 全绿。

---

# 第二轮：test-fresh 全量暴露 Batch C 引入的系统性回归（单一根因）

起 `make test-fresh` 后，从 #392 起系统性红一大片(392/399/401/410/453/469/486/487/537/567/616…)，
全是 citation / corpus / grounding / ACL-freeze 类。**掐掉全量**(单一根因、跑完只是浪费~25min)，
读 error-context + 后端日志 + 直接查 DB 定位。

## 根因(DB 实证)

- `WikiRepo.Create`(`postgres/wiki.go:55`)与 `buildOutputCreateParams`(`postgres/output.go:69`)
  组 `dbq.CreateNoteParams` 时**漏了 `ShowAsSource` 字段** → Go 零值 `false`。
- 而 `CreateNote` 的 INSERT 显式列了 `show_as_source = $9`(`corpus_notes.sql:6`)，
  于是把 `false` 写进去，**盖掉 schema 的 `DEFAULT true`**。
- 实证：`SELECT genre,title,show_as_source FROM corpus_notes` → 所有 `wiki`/`output` 行 = `f`。
- 本轮新加的 **Batch C gate**(`agent_turn_persist.go suppressedFromCitation`：wiki/output 且
  `!show_as_source` → 不进 cited；前端 `citableCorpusRead` 同款 gate)于是把**所有**正常
  wiki/output 都误当隐藏条 → citation 全丢。前端 live citation + 后端 cited_wiki_ids 双双丢，
  所以 reload 前/后都断言失败。
- 为什么"1052 passed"那次没红：那次 gate 还没实现(Batch C 当时标"待修")，`false` 一直无害；
  gate 一落地就把这条潜伏值激活成 bug。corpus_read 本身一直正常(`agent tool done corpus_read`)。

## 修(invariant，非点修)

- wiki/output 建出来即是可引用的 source；藏(meta/persona)是之后 `UpdateWiki`
  (`applyShowAsSourceIfHidden`)的例外路径。两个 create-param builder 显式
  `ShowAsSource: true`，让"新建 corpus entry 即 citable source"成为 repo 层不变量。
- subjectivity 的 `NoteRepo.Create` 本就 `ShowAsSource: in.ShowAsSource`(opt-in 默认藏)，不动。

## 验证
- `conversation-multi-citation-reload` ✅；DB 现在 wiki/output = `t`。
- 6-spec 组 ✅（mcp-show-grounding / corpus-facade-lister / corpus-tree-integrity ×5 /
  corpus-crud-ui / visitor-chat-cites-output / **visitor-chat-hidden-source**）——
  hidden 条仍被正确 suppress，证明 gate 没坏、fix 只放行正常条。
- 5-spec 组 ✅（floating-chat-dock / ghost-ledger / iam-role-freeze ×2 /
  output-retrieval-scale / public-page）——所观察到的全部红都随单一 fix 转绿。
- → 现在跑最后一次全量 `test-fresh`。
