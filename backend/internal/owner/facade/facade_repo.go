package owner

import "github.com/atmaxmoj/standmeet/internal/owner/repo"

// 类型（实现:repo）.
type (
	CustomBuildRepo = repo.CustomBuildRepo
	CustomPageRepo  = repo.CustomPageRepo
	InstanceRepo    = repo.InstanceRepo
	KeypairRepo     = repo.KeypairRepo
	PromptRepo      = repo.PromptRepo
	Repo            = repo.Repo
)

// 构造/函数（实现:repo）.
var (
	NewCustomBuildRepo = repo.NewCustomBuildRepo
	NewCustomPageRepo  = repo.NewCustomPageRepo
	NewInstanceRepo    = repo.NewInstanceRepo
	NewKeypairRepo     = repo.NewKeypairRepo
	NewPromptRepo      = repo.NewPromptRepo
	NewRepo            = repo.NewRepo
)
