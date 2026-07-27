// Package marketplace —— 市场域(角色可挂载的 MCP server + skill)的对外 facade。薄薄一层,
// 把内部子包的类型/构造/用例抬上来;别的层只 import 这个 facade 包。实现是同域兄弟子包
// internal/marketplace/{entity,repo,usecase,db},由 check-domain-facade-boundary 挡住外部直引。
//
// # 对外协议
//
//   - 实体(entity): Skill / MCPServerConfig / MarketSkill(+ Source/Content)· Err* 域错误
//   - 仓储(repo): SkillRepo / MCPServerRepo + Create* 入参
//   - 用例(usecase): skill / mcp-server 的 CRUD + seed + 市场拉取(github / skills.mp 客户端)
package marketplace
