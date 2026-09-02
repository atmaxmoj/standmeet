package marketplace

import "github.com/atmaxmoj/standmeet/internal/marketplace/entity"

// Types (implemented by: entity).
type (
	DialableMCPServer = entity.DialableMCPServer
	MCPAuthHeader     = entity.MCPAuthHeader
	MCPServerConfig   = entity.MCPServerConfig
	MarketSkill       = entity.MarketSkill
	Skill             = entity.Skill
	SkillScript       = entity.SkillScript
	SkillScriptParam  = entity.SkillScriptParam
)

// Errors/vars (implemented by: entity).
var (
	ErrMCPServerNameTaken    = entity.ErrMCPServerNameTaken
	ErrMCPServerNotFound     = entity.ErrMCPServerNotFound
	ErrSkillBuiltinImmutable = entity.ErrSkillBuiltinImmutable
	ErrSkillNameTaken        = entity.ErrSkillNameTaken
	ErrSkillNotFound         = entity.ErrSkillNotFound
)
