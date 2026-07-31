package owner

import "github.com/atmaxmoj/standmeet/internal/owner/entity"

// 类型（实现:entity）.
type (
	AICredential    = entity.AICredential
	CustomPage      = entity.CustomPage
	CustomPageBuild = entity.CustomPageBuild
	KeypairMetadata = entity.KeypairMetadata
	Owner           = entity.Owner
	PageContact     = entity.PageContact
	PageContent     = entity.PageContent
	PageWhere       = entity.PageWhere
	Prompt          = entity.Prompt
	Settings        = entity.Settings
)

// 构造/函数（实现:entity）.
var (
	LoadPromptFragment     = entity.LoadPromptFragment
	MustLoadPromptFragment = entity.MustLoadPromptFragment
)

// 错误/变量（实现:entity）.
var (
	ErrCustomPageBuildNotFound  = entity.ErrCustomPageBuildNotFound
	ErrCustomPageNotFound       = entity.ErrCustomPageNotFound
	ErrCustomPageSlugTaken      = entity.ErrCustomPageSlugTaken
	ErrEmailTaken               = entity.ErrEmailTaken
	ErrHandleTaken              = entity.ErrHandleTaken
	ErrInstanceSettingsNotFound = entity.ErrInstanceSettingsNotFound
	ErrInvalidSetupToken        = entity.ErrInvalidSetupToken
	ErrKeypairUnauthorized      = entity.ErrKeypairUnauthorized
	ErrOwnerNotFound            = entity.ErrOwnerNotFound
	ErrPageNotFound             = entity.ErrPageNotFound
	ErrPinNotFound              = entity.ErrPinNotFound
	ErrPinUnpublished           = entity.ErrPinUnpublished
	ErrPromptBuiltinImmutable   = entity.ErrPromptBuiltinImmutable
	ErrPromptFragmentNotFound   = entity.ErrPromptFragmentNotFound
	ErrPromptNameTaken          = entity.ErrPromptNameTaken
	ErrPromptNotFound           = entity.ErrPromptNotFound
	ErrPublicURLNotSet          = entity.ErrPublicURLNotSet
	ErrUnauthorized             = entity.ErrUnauthorized
)
