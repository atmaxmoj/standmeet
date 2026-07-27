package usecase

import "context"

// role 挂载引用的种类 —— 是数据(字符串),不是类型。access 不为每种引用持一个类型化口。
const (
	RefPrompt    = "prompt"
	RefSkill     = "skill"
	RefMCPServer = "mcp_server"
)

// RefValidator —— role 写入时校验一个挂载引用(按 kind)存在的窄 consumer 口。只做存在性
// 校验(丢弃实体),故只返 error;kind→具体 repo.GetByID 的分派由 composition root 适配。
// access 因此既不为每种引用持类型化 surface,也不反依赖 owner/marketplace(它俩已依赖 access)。
type RefValidator interface {
	RefExists(ctx context.Context, ownerID, kind, id string) error
}
