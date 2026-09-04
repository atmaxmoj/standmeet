package owner

import "github.com/atmaxmoj/standmeet/internal/owner/usecase"

// Types (impl: usecase).
type (
	AIProviderDeps             = usecase.AIProviderDeps
	ProvidersUseDeps           = usecase.ProvidersDeps
	ProviderModelLister        = usecase.ProviderModelLister
	AccountDeps                = usecase.AccountDeps
	AllowedDomainsDeps         = usecase.AllowedDomainsDeps
	ApproveRequestDeps         = usecase.ApproveRequestDeps
	BYOAIDeps                  = usecase.BYOAIDeps
	CSSStore                   = usecase.CSSStore
	VaultImportStore           = usecase.VaultImportStore
	ClaimDeps                  = usecase.ClaimDeps
	ClaimInput                 = usecase.ClaimInput
	CreateKeypairInputReq      = usecase.CreateKeypairInputReq
	CreatePageInput            = usecase.CreatePageInput
	CreatePromptInputReq       = usecase.CreatePromptInputReq
	CreatedKeypair             = usecase.CreatedKeypair
	CustomPageDeps             = usecase.CustomPageDeps
	EmailUpdateInput           = usecase.EmailUpdateInput
	HandleDeps                 = usecase.HandleDeps
	KeyChange                  = usecase.KeyChange
	KeypairDeps                = usecase.KeypairDeps
	LandingURL                 = usecase.LandingURL
	LoginDeps                  = usecase.LoginDeps
	LoginInput                 = usecase.LoginInput
	LoginOutput                = usecase.LoginOutput
	OutboundStatusDeps         = usecase.OutboundStatusDeps
	NonceStore                 = usecase.NonceStore
	OutboundNotice             = usecase.OutboundNotice
	OutboundSender             = usecase.OutboundSender
	PageDeps                   = usecase.PageDeps
	CorpusCard                 = usecase.CorpusCard
	PasswordResetDeps          = usecase.PasswordResetDeps
	PasswordUpdateInput        = usecase.PasswordUpdateInput
	PromptsDeps                = usecase.PromptsDeps
	ProviderValidator          = usecase.ProviderValidator
	PublicURLDeps              = usecase.PublicURLDeps
	RecoverInput               = usecase.RecoverInput
	RecoveryDeps               = usecase.RecoveryDeps
	EmailChangeDeps            = usecase.EmailChangeDeps
	LivePage                   = usecase.LivePage
	LivePageLink               = usecase.LivePageLink
	SEODeps                    = usecase.SEODeps
	SetupTokenIssuer           = usecase.SetupTokenIssuer
	SoleOwnerLookup            = usecase.SoleOwnerLookup
	UpdateBYOAIInputReq        = usecase.UpdateBYOAIInputReq
	UpdateOwnerAIProviderInput = usecase.UpdateOwnerAIProviderInput
	UpdatePromptInputReq       = usecase.UpdatePromptInputReq
	WikiContext                = usecase.WikiContext
	WikiTreeNode               = usecase.WikiTreeNode
	WikiTreeScope              = usecase.WikiTreeScope
	LandingI18n                = usecase.LandingI18n
	WriteFileInput             = usecase.WriteFileInput
)

// Constructors/functions (impl: usecase).
var (
	ErrOutboundNotConfigured   = usecase.ErrOutboundNotConfigured
	AddAllowedDomain           = usecase.AddAllowedDomain
	ApproveAccessRequest       = usecase.ApproveAccessRequest
	Build                      = usecase.Build
	CanDeliverCodes            = usecase.CanDeliverCodes
	ClaimInstance              = usecase.ClaimInstance
	ConsumePasswordResetToken  = usecase.ConsumePasswordResetToken
	CreateKeypair              = usecase.CreateKeypair
	CreatePage                 = usecase.CreatePage
	InstallDefaultHomepage     = usecase.InstallDefaultHomepage
	CreatePrompt               = usecase.CreatePrompt
	GetWikiLandingInLang       = usecase.GetWikiLandingInLang
	GasRemaining               = usecase.GasRemaining
	DefaultProviderID          = usecase.DefaultProviderID
	DeleteKeypair              = usecase.DeleteKeypair
	DeletePage                 = usecase.DeletePage
	DeletePrompt               = usecase.DeletePrompt
	EnsureUnclaimedSetupToken  = usecase.EnsureUnclaimedSetupToken
	FirstOwner                 = usecase.FirstOwner
	GenerateRecovery           = usecase.GenerateRecovery
	GetBuild                   = usecase.GetBuild
	GetOutputLanding           = usecase.GetOutputLanding
	GetPrompt                  = usecase.GetPrompt
	GetWikiLanding             = usecase.GetWikiLanding
	IndexedOutputLandings      = usecase.IndexedOutputLandings
	IndexedWikiLandings        = usecase.IndexedWikiLandings
	ListAllowedDomains         = usecase.ListAllowedDomains
	ListKeypairs               = usecase.ListKeypairs
	ListPages                  = usecase.ListPages
	ListPrompts                = usecase.ListPrompts
	LoadSoleOwner              = usecase.LoadSoleOwner
	SeedPublicRole             = usecase.SeedPublicRole
	Login                      = usecase.Login
	ListPublishedCards         = usecase.ListPublishedCards
	PromoteToLive              = usecase.PromoteToLive
	PromoteToStaging           = usecase.PromoteToStaging
	AutopublishHomepageOnBuilt = usecase.AutopublishHomepageOnBuilt
	PublicReady                = usecase.PublicReady
	Recover                    = usecase.Recover
	ConfirmEmailChange         = usecase.ConfirmEmailChange
	ErrPendingEmailExpired     = usecase.ErrPendingEmailExpired
	RemoveAllowedDomain        = usecase.RemoveAllowedDomain
	ResolveLiveBuild           = usecase.ResolveLiveBuild
	LiveCustomPages            = usecase.LiveCustomPages
	ResolvePreviewBuild        = usecase.ResolvePreviewBuild
	NewPreviewToken            = usecase.NewPreviewToken
	VerifyPreviewToken         = usecase.VerifyPreviewToken
	Rollback                   = usecase.Rollback
	SetOwnerCSS                = usecase.SetOwnerCSS
	UpdateBYOAI                = usecase.UpdateBYOAI
	UpdateOwnerAIProvider      = usecase.UpdateOwnerAIProvider
	UpdateOwnerEmail           = usecase.UpdateOwnerEmail
	UpdateOwnerFullName        = usecase.UpdateOwnerFullName
	UpdateOwnerHandle          = usecase.UpdateOwnerHandle
	UpdateOwnerPassword        = usecase.UpdateOwnerPassword
	UpdateOwnerPublicURL       = usecase.UpdateOwnerPublicURL
	UpdatePrompt               = usecase.UpdatePrompt
	VerifySigv1                = usecase.VerifySigv1
	WikiNodeContext            = usecase.WikiNodeContext
	WikiTreeChildren           = usecase.WikiTreeChildren
	WikiTreeScopeFor           = usecase.WikiTreeScopeFor
	WikiTreeStats              = usecase.WikiTreeStats
	WriteFile                  = usecase.WriteFile
)

// Constants (impl: usecase).
const (
	KeyClear = usecase.KeyClear
	KeyKeep  = usecase.KeyKeep
	KeySet   = usecase.KeySet

	// HomepageSlug — the reserved slug the public homepage route serves at `/`.
	HomepageSlug = usecase.HomepageSlug
)

// Errors/vars (impl: usecase).
var (
	ErrPasswordTooShort = usecase.ErrPasswordTooShort
	ErrPublicURLInvalid = usecase.ErrPublicURLInvalid
)
