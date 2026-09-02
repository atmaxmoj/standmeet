package access

import "github.com/atmaxmoj/standmeet/internal/access/repo"

// Types (impl: repo).
type (
	APIKeyRepo         = repo.APIKeyRepo
	CapabilityRepo     = repo.CapabilityRepo
	CodeDenialRepo     = repo.CodeDenialRepo
	CodeRepo           = repo.CodeRepo
	EmbedRepo          = repo.EmbedRepo
	CreateCodeInput    = repo.CreateCodeInput
	RequestRepo        = repo.RequestRepo
	RoleRepo           = repo.RoleRepo
	UpsertBuiltinInput = repo.UpsertBuiltinInput
)

// Constructors/functions (impl: repo).
var (
	CreateAccessCodeTx   = repo.CreateAccessCodeTx
	NewAPIKeyRepo        = repo.NewAPIKeyRepo
	NewAccessRequestRepo = repo.NewAccessRequestRepo
	NewCapabilityRepo    = repo.NewCapabilityRepo
	NewCodeDenialRepo    = repo.NewCodeDenialRepo
	NewCodeRepo          = repo.NewCodeRepo
	NewEmbedRepo         = repo.NewEmbedRepo
	NewRoleRepo          = repo.NewRoleRepo
)
