package marketplace

import "github.com/atmaxmoj/standmeet/internal/marketplace/entity"

// 类型（实现:entity）.
type (
	MCPServerConfig  = entity.MCPServerConfig
	MarketSkill      = entity.MarketSkill
	Skill            = entity.Skill
	SkillScript      = entity.SkillScript
	SkillScriptParam = entity.SkillScriptParam
)

// 错误/变量（实现:entity）.
var (
	ErrMCPServerNameTaken    = entity.ErrMCPServerNameTaken
	ErrMCPServerNotFound     = entity.ErrMCPServerNotFound
	ErrSkillBuiltinImmutable = entity.ErrSkillBuiltinImmutable
	ErrSkillNameTaken        = entity.ErrSkillNameTaken
	ErrSkillNotFound         = entity.ErrSkillNotFound
)
