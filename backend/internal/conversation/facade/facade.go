// Package conversation —— 会话域(访客与 AI 的对话 + 记录)的对外 facade。薄薄一层,把内部子包的
// 类型/构造/用例抬上来;别的层只 import 这个 facade 包。实现是同域兄弟子包
// internal/conversation/{entity,repo,usecase,db}（以及 inference 子模块）,由
// check-domain-facade-boundary 挡住外部直引 guts。
//
// # 对外协议
//
//   - 实体(entity): Chat / Dialog / Message / Citation / ChatReport / Ghost / ChatMode …
//   - 仓储(repo): ChatRepo / ChatReportRepo / GhostRepo / AppStateRepo + 查询/写入类型
//   - 用例(usecase): 访客对话编排(visitor chat / history / turn-quota / role-snapshot / prompt) +
//     会话视图 + dialog + ghost policy/ledger + summarize report(#135 待外置残留)
//
// LLM 调用/agent-loop 在 inference 子模块(自有边界),不经本 facade。
package conversation
