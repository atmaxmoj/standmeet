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
	// ProviderRow —— 本子里的一条。KeyEnc 仍是密文：**开封只发生在组装根**
	// （`cmd/server/unseal.go`），这里出来的只是那一行的样子（F-R-11）。
	ProviderRow = repo.ProviderRow
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
