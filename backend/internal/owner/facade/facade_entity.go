package owner

import "github.com/atmaxmoj/standmeet/internal/owner/entity"

// Types (impl: entity).
type (
	Microsite         = entity.Microsite
	MicrositeBuild    = entity.MicrositeBuild
	MicrositeDocument = entity.MicrositeDocument
	KeypairMetadata   = entity.KeypairMetadata
	Owner             = entity.Owner
	Prompt            = entity.Prompt
	Settings          = entity.Settings
	// VaultImportReceipt —— the most recent vault import (UX-62). At zero value = never imported.
	VaultImportReceipt = entity.VaultImportReceipt
)

// Constructors/functions (impl: entity).
var (
	LoadPromptFragment     = entity.LoadPromptFragment
	MustLoadPromptFragment = entity.MustLoadPromptFragment
)

// Errors/vars (impl: entity).
var (
	ErrMicrositeBuildNotFound    = entity.ErrMicrositeBuildNotFound
	ErrMicrositeNotFound         = entity.ErrMicrositeNotFound
	ErrMicrositeSlugTaken        = entity.ErrMicrositeSlugTaken
	ErrMicrositeStoreNotWritable = entity.ErrMicrositeStoreNotWritable
	ErrMicrositeStoreQuota       = entity.ErrMicrositeStoreQuota
	ErrEmailTaken                = entity.ErrEmailTaken
	ErrHandleTaken               = entity.ErrHandleTaken
	ErrInstanceSettingsNotFound  = entity.ErrInstanceSettingsNotFound
	ErrInvalidSetupToken         = entity.ErrInvalidSetupToken
	ErrKeypairUnauthorized       = entity.ErrKeypairUnauthorized
	ErrOwnerNotFound             = entity.ErrOwnerNotFound
	ErrPromptBuiltinImmutable    = entity.ErrPromptBuiltinImmutable
	ErrPromptFragmentNotFound    = entity.ErrPromptFragmentNotFound
	ErrPromptNameTaken           = entity.ErrPromptNameTaken
	ErrPromptNotFound            = entity.ErrPromptNotFound
	ErrPublicURLNotSet           = entity.ErrPublicURLNotSet
	ErrUnauthorized              = entity.ErrUnauthorized
	ErrPendingEmailNotFound      = entity.ErrPendingEmailNotFound
)
