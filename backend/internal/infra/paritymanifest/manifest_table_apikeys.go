package paritymanifest

// apiKeyEntries —— API-key facade 的 owner 侧管理(发钥匙 / 列 / 撤 / 改 + per-key 收窄
// + 开给 API 面的候选开关)已经搬进 access 域自己的声明(internal/access/ops),收口去
// facade 取。
//
// 于是这张表不再需要它们的行:"只在 MCP 上"这个决定连同理由写在那条声明的 Reach 上,
// 启动时由 dispatcher.Conform() 对账 —— 这正是这个包最后要消失的方式。
func apiKeyEntries() []Entry {
	return []Entry{}
}
