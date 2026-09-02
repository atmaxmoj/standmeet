package marketplace

import "github.com/atmaxmoj/standmeet/internal/marketplace/repo"

// Types (implemented by: repo).
type (
	MCPServerRepo = repo.MCPServerRepo
	SkillRepo     = repo.SkillRepo
)

// Constructors/functions (implemented by: repo).
var (
	NewMCPServerRepo = repo.NewMCPServerRepo
	NewSkillRepo     = repo.NewSkillRepo
)
