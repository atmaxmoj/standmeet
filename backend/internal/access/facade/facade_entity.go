package access

import "github.com/atmaxmoj/standmeet/internal/access/entity"

// Types (impl: entity).
type (
	APIKey                = entity.APIKey
	Code                  = entity.Code
	CodeMember            = entity.CodeMember
	CorpusEntryRef        = entity.CorpusEntryRef
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

// Constructors/functions (impl: entity).
var (
	AllowsCorpusEntry       = entity.AllowsCorpusEntry
	FilterWaypointsByCorpus = entity.FilterWaypointsByCorpus
	MergeWaypoints          = entity.MergeWaypoints
	NewRoleSnapshot         = entity.NewRoleSnapshot
	ValidateWaypoints       = entity.ValidateWaypoints
)

// Constants (impl: entity).
const (
	InvitedRoleDescription = entity.InvitedRoleDescription
	InvitedRoleName        = entity.InvitedRoleName
	PublicRoleDescription  = entity.PublicRoleDescription
	PublicRoleName         = entity.PublicRoleName
)

// Errors/vars (impl: entity).
var (
	ErrAPIKeyNotFound             = entity.ErrAPIKeyNotFound
	ErrAccessRequestNotFound      = entity.ErrAccessRequestNotFound
	ErrAccessRequestStatusInvalid = entity.ErrAccessRequestStatusInvalid
	ErrCodeExpired                = entity.ErrCodeExpired
	ErrCodeInvalid                = entity.ErrCodeInvalid
	ErrCodeRevoked                = entity.ErrCodeRevoked
	ErrCodeTaken                  = entity.ErrCodeTaken
	ErrDockButtonEmptyTrigger     = entity.ErrDockButtonEmptyTrigger
	ErrGasExhausted               = entity.ErrGasExhausted
	ErrPeriodLimitReached         = entity.ErrPeriodLimitReached
	ErrEmbedOriginNotAllowed      = entity.ErrEmbedOriginNotAllowed
	ErrEmbedTokenInvalid          = entity.ErrEmbedTokenInvalid
	ErrMemberNotFound             = entity.ErrMemberNotFound
	ErrMemberQuotaReached         = entity.ErrMemberQuotaReached
	ErrRoleBuiltinImmutable       = entity.ErrRoleBuiltinImmutable
	ErrRoleNameTaken              = entity.ErrRoleNameTaken
	ErrRoleNotFound               = entity.ErrRoleNotFound
	ErrTooManyDockButtons         = entity.ErrTooManyDockButtons
	ErrTurnQuotaReached           = entity.ErrTurnQuotaReached
	ErrUnknownDockCapability      = entity.ErrUnknownDockCapability
	InvitedRoleCorpusURIs         = entity.InvitedRoleCorpusURIs
	PublicRoleCorpusURIs          = entity.PublicRoleCorpusURIs
)
