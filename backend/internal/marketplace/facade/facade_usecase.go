package marketplace

import "github.com/atmaxmoj/standmeet/internal/marketplace/usecase"

// 类型（实现:usecase）.
type (
	Client             = usecase.Client
	ConnectorNeeds     = usecase.ConnectorNeeds
	CreateMCPServerReq = usecase.CreateMCPServerReq
	CreateSkillReq     = usecase.CreateSkillReq
	InstallSkillDeps   = usecase.InstallSkillDeps
	InstallSkillInput  = usecase.InstallSkillInput
	MCPProbeResult     = usecase.MCPProbeResult
	MCPServerProber    = usecase.MCPServerProber
	MCPServersDeps     = usecase.MCPServersDeps
	SearchDeps         = usecase.SearchDeps
	SearchParams       = usecase.SearchParams
	SkillsDeps         = usecase.SkillsDeps
)

// 构造/函数（实现:usecase）.
var (
	// 探针失败的两类 —— 组装根拨完号，用它们说清是哪一种（F-D-15）。
	ErrMCPServerRefusedAuth = usecase.ErrMCPServerRefusedAuth
	ErrMCPServerNoAnswer    = usecase.ErrMCPServerNoAnswer

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
