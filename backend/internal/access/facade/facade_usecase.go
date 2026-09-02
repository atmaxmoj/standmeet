package access

import "github.com/atmaxmoj/standmeet/internal/access/usecase"

// Types (impl: usecase).
type (
	APIKeyRoleGetter         = usecase.APIKeyRoleGetter
	CodeACLDeps              = usecase.CodeACLDeps
	CodeQuotaUpdate          = usecase.CodeQuotaUpdate
	CodesDeps                = usecase.CodesDeps
	IssueAPIKeyDeps          = usecase.IssueAPIKeyDeps
	IssueAPIKeyInput         = usecase.IssueAPIKeyInput
	OptionalQuota            = usecase.OptionalQuota
	IssuedVisitor            = usecase.IssuedVisitor
	RefValidator             = usecase.RefValidator
	RequestsDeps             = usecase.RequestsDeps
	RoleWriteInput           = usecase.RoleWriteInput
	RolesDeps                = usecase.RolesDeps
	SetDockButtonsInput      = usecase.SetDockButtonsInput
	SoleOwnerLookup          = usecase.SoleOwnerLookup
	SubmitAccessRequestInput = usecase.SubmitAccessRequestInput
	VisitorSessionData       = usecase.VisitorSessionData
	VisitorSessionStore      = usecase.VisitorSessionStore
	EmbedTokenDeps           = usecase.EmbedTokenDeps
	EmbedNonceStore          = usecase.NonceStore
)

// Constructors/functions (impl: usecase).
var (
	CountActiveCodesForRole   = usecase.CountActiveCodesForRole
	CreateRole                = usecase.CreateRole
	DeleteRole                = usecase.DeleteRole
	GetRole                   = usecase.GetRole
	IssueAPIKey               = usecase.IssueAPIKey
	IssueCode                 = usecase.IssueCode
	ListForOwner              = usecase.ListForOwner
	ListRoles                 = usecase.ListRoles
	NewVisitorSessionStore    = usecase.NewVisitorSessionStore
	ResolveAPIKey             = usecase.ResolveAPIKey
	RevokeCode                = usecase.RevokeCode
	SetRoleDockButtons        = usecase.SetRoleDockButtons
	SubmitForOwner            = usecase.SubmitForOwner
	UpdateAccessRequestStatus = usecase.UpdateAccessRequestStatus
	UpdateCodeQuotas          = usecase.UpdateCodeQuotas
	UpdateRole                = usecase.UpdateRole
	VerifyEmbedToken          = usecase.VerifyEmbedToken
)

// Constants (impl: usecase).
const (
	RefMCPServer = usecase.RefMCPServer
	RefPrompt    = usecase.RefPrompt
	RefSkill     = usecase.RefSkill
)

// Errors/vars (impl: usecase).
var (
	ErrAPIKeyLabelRequired    = usecase.ErrAPIKeyLabelRequired
	ErrAPIKeyRoleRequired     = usecase.ErrAPIKeyRoleRequired
	ErrRefMCPServerNotFound   = usecase.ErrRefMCPServerNotFound
	ErrRefPromptNotFound      = usecase.ErrRefPromptNotFound
	ErrRefSkillNotFound       = usecase.ErrRefSkillNotFound
	ErrVisitorSessionNotFound = usecase.ErrVisitorSessionNotFound
)
