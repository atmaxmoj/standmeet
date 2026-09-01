package access

import "github.com/atmaxmoj/standmeet/internal/access/repo"

// 类型（实现:repo）.
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

// 构造/函数（实现:repo）.
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
