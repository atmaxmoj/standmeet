package access

import "github.com/atmaxmoj/standmeet/internal/access/usecase"

// 类型（实现:usecase）.
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
)

// 构造/函数（实现:usecase）.
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
)

// 常量（实现:usecase）.
const (
	RefMCPServer = usecase.RefMCPServer
	RefPrompt    = usecase.RefPrompt
	RefSkill     = usecase.RefSkill
)

// 错误/变量（实现:usecase）.
var (
	ErrAPIKeyLabelRequired    = usecase.ErrAPIKeyLabelRequired
	ErrAPIKeyRoleRequired     = usecase.ErrAPIKeyRoleRequired
	ErrVisitorSessionNotFound = usecase.ErrVisitorSessionNotFound
)
