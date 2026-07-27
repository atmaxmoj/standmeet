package marketplace

import "github.com/atmaxmoj/standmeet/internal/marketplace/usecase"

// 类型（实现:usecase）.
type (
	Client             = usecase.Client
	CreateMCPServerReq = usecase.CreateMCPServerReq
	CreateSkillReq     = usecase.CreateSkillReq
	InstallSkillDeps   = usecase.InstallSkillDeps
	InstallSkillInput  = usecase.InstallSkillInput
	MCPServersDeps     = usecase.MCPServersDeps
	SearchDeps         = usecase.SearchDeps
	SearchParams       = usecase.SearchParams
	SkillsDeps         = usecase.SkillsDeps
)

// 构造/函数（实现:usecase）.
var (
	CreateMCPServer    = usecase.CreateMCPServer
	CreateSkill        = usecase.CreateSkill
	DeleteMCPServer    = usecase.DeleteMCPServer
	DeleteSkill        = usecase.DeleteSkill
	GrantMCPServerDep  = usecase.GrantMCPServerDep
	InstallManualSkill = usecase.InstallManualSkill
	InstallSkill       = usecase.InstallSkill
	ListMCPServers     = usecase.ListMCPServers
	ListSkills         = usecase.ListSkills
	NewFromEnv         = usecase.NewFromEnv
	SearchMarketplace  = usecase.SearchMarketplace
	SeedBuiltinSkills  = usecase.SeedBuiltinSkills
	SetSkillEnabled    = usecase.SetSkillEnabled
)
