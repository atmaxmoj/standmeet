package access

import "github.com/atmaxmoj/standmeet/internal/access/entity"

// 类型（实现:entity）.
type (
	APIKey                = entity.APIKey
	Code                  = entity.Code
	CodeMember            = entity.CodeMember
	CorpusScope           = entity.CorpusScope
	CreateAPIKeyInput     = entity.CreateAPIKeyInput
	CreateAccessCodeInput = entity.CreateAccessCodeInput
	DockButtonConfig      = entity.DockButtonConfig
	Request               = entity.Request
	Role                  = entity.Role
	RoleSnapshot          = entity.RoleSnapshot
	RoleSnapshotInit      = entity.RoleSnapshotInit
	UpdateAPIKeyInput     = entity.UpdateAPIKeyInput
	VisitorProfile        = entity.VisitorProfile
	Waypoint              = entity.Waypoint
)

// 构造/函数（实现:entity）.
var (
	AllowsCorpusScope       = entity.AllowsCorpusScope
	FilterWaypointsByCorpus = entity.FilterWaypointsByCorpus
	MergeWaypoints          = entity.MergeWaypoints
	NewRoleSnapshot         = entity.NewRoleSnapshot
	ValidateWaypoints       = entity.ValidateWaypoints
)

// 常量（实现:entity）.
const (
	PublicRoleDescription = entity.PublicRoleDescription
	PublicRoleName        = entity.PublicRoleName
)

// 错误/变量（实现:entity）.
var (
	ErrAPIKeyNotFound             = entity.ErrAPIKeyNotFound
	ErrAccessRequestNotFound      = entity.ErrAccessRequestNotFound
	ErrAccessRequestStatusInvalid = entity.ErrAccessRequestStatusInvalid
	ErrCodeExpired                = entity.ErrCodeExpired
	ErrCodeInvalid                = entity.ErrCodeInvalid
	ErrCodeTaken                  = entity.ErrCodeTaken
	ErrDockButtonEmptyTrigger     = entity.ErrDockButtonEmptyTrigger
	ErrMemberNotFound             = entity.ErrMemberNotFound
	ErrMemberQuotaReached         = entity.ErrMemberQuotaReached
	ErrRoleBuiltinImmutable       = entity.ErrRoleBuiltinImmutable
	ErrRoleNameTaken              = entity.ErrRoleNameTaken
	ErrRoleNotFound               = entity.ErrRoleNotFound
	ErrTooManyDockButtons         = entity.ErrTooManyDockButtons
	ErrTurnQuotaReached           = entity.ErrTurnQuotaReached
	ErrUnknownDockCapability      = entity.ErrUnknownDockCapability
	PublicRoleCorpusURIs          = entity.PublicRoleCorpusURIs
)
