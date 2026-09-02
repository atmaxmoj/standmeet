package marketplace

import "github.com/atmaxmoj/standmeet/internal/marketplace/usecase"

// Types (implemented by: usecase).
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

// Constructors/functions (implemented by: usecase).
var (
	// Two probe-failure classes -- once the composition root finishes dialing, use these
	// to state which kind it is (F-D-15).
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
