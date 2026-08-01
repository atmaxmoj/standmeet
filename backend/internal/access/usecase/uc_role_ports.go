package usecase

import (
	"context"
	"errors"
)

// role 挂载引用的种类 —— 是数据(字符串),不是类型。access 不为每种引用持一个类型化口。
const (
	RefPrompt    = "prompt"
	RefSkill     = "skill"
	RefMCPServer = "mcp_server"
)

// 引用不存在 —— 每种一个哨兵。这是**这个口子自己的**词汇:owner / marketplace 的哨兵在
// 它们各自的域里,access 反过来认那些名字就成了反向依赖(它俩已经依赖 access)。适配器
// 把自己那边的"找不到"翻成这里的一个,调用方据此说人话。
var (
	// ErrRefPromptNotFound —— 挂的 prompt 不属于这个 owner 或不存在。
	ErrRefPromptNotFound = errors.New("role ref: prompt not found")
	// ErrRefSkillNotFound —— 挂的 skill 不属于这个 owner 或不存在。
	ErrRefSkillNotFound = errors.New("role ref: skill not found")
	// ErrRefMCPServerNotFound —— 挂的外部 MCP server 不属于这个 owner 或不存在。
	ErrRefMCPServerNotFound = errors.New("role ref: mcp server not found")
)

// RefValidator —— role 写入时校验一个挂载引用(按 kind)存在的窄 consumer 口。只做存在性
// 校验(丢弃实体),故只返 error;kind→具体 repo.GetByID 的分派由 composition root 适配。
// access 因此既不为每种引用持类型化 surface,也不反依赖 owner/marketplace(它俩已依赖 access)。
type RefValidator interface {
	RefExists(ctx context.Context, ownerID, kind, id string) error
}
