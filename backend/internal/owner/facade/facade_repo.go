package owner

import "github.com/atmaxmoj/standmeet/internal/owner/repo"

// Types (impl: repo).
type (
	CustomBuildRepo = repo.CustomBuildRepo
	CustomPageRepo  = repo.CustomPageRepo
	InstanceRepo    = repo.InstanceRepo
	KeypairRepo     = repo.KeypairRepo
	PromptRepo      = repo.PromptRepo
	Repo            = repo.Repo
	// ProviderRow —— one row from that ledger. KeyEnc stays ciphertext: **unsealing happens
	// only at the composition root** (`cmd/server/unseal.go`); what comes out here is just
	// that row's shape (F-R-11).
	ProviderRow = repo.ProviderRow
)

// Constructors/functions (impl: repo).
var (
	NewCustomBuildRepo = repo.NewCustomBuildRepo
	NewCustomPageRepo  = repo.NewCustomPageRepo
	NewInstanceRepo    = repo.NewInstanceRepo
	NewKeypairRepo     = repo.NewKeypairRepo
	NewPromptRepo      = repo.NewPromptRepo
	NewRepo            = repo.NewRepo
)
