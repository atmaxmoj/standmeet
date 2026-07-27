package marketplace

import "github.com/atmaxmoj/standmeet/internal/marketplace/repo"

// 类型（实现:repo）.
type (
	MCPServerRepo = repo.MCPServerRepo
	SkillRepo     = repo.SkillRepo
)

// 构造/函数（实现:repo）.
var (
	NewMCPServerRepo = repo.NewMCPServerRepo
	NewSkillRepo     = repo.NewSkillRepo
)
