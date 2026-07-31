package owner

import "github.com/atmaxmoj/standmeet/internal/owner/usecase"

// 类型（实现:usecase）.
type (
	AIProviderDeps             = usecase.AIProviderDeps
	CancelBookingInput         = usecase.CancelBookingInput
	CancelBookingStore         = usecase.CancelBookingStore
	CancelOwnBookingInput      = usecase.CancelOwnBookingInput
	VisitorCancelDeps          = usecase.VisitorCancelDeps
	AccountDeps                = usecase.AccountDeps
	AllowedDomainsDeps         = usecase.AllowedDomainsDeps
	ApproveRequestDeps         = usecase.ApproveRequestDeps
	BYOAIDeps                  = usecase.BYOAIDeps
	CSSStore                   = usecase.CSSStore
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
	MailStatusDeps             = usecase.MailStatusDeps
	NonceStore                 = usecase.NonceStore
	OutboundMessage            = usecase.OutboundMessage
	OutboundSender             = usecase.OutboundSender
	PageDeps                   = usecase.PageDeps
	PagePinDeps                = usecase.PagePinDeps
	PasswordResetDeps          = usecase.PasswordResetDeps
	PasswordUpdateInput        = usecase.PasswordUpdateInput
	PromptsDeps                = usecase.PromptsDeps
	ProviderValidator          = usecase.ProviderValidator
	PublicPageView             = usecase.PublicPageView
	PublicURLDeps              = usecase.PublicURLDeps
	RecoverInput               = usecase.RecoverInput
	RecoveryDeps               = usecase.RecoveryDeps
	SEODeps                    = usecase.SEODeps
	SetupTokenIssuer           = usecase.SetupTokenIssuer
	SoleOwnerLookup            = usecase.SoleOwnerLookup
	UpdateBYOAIInputReq        = usecase.UpdateBYOAIInputReq
	UpdateOwnerAIProviderInput = usecase.UpdateOwnerAIProviderInput
	UpdatePromptInputReq       = usecase.UpdatePromptInputReq
	WikiContext                = usecase.WikiContext
	WikiSEOUpdate              = usecase.WikiSEOUpdate
	WikiTreeNode               = usecase.WikiTreeNode
	WikiTreeScope              = usecase.WikiTreeScope
	WriteFileInput             = usecase.WriteFileInput
)

// 构造/函数（实现:usecase）.
var (
	AddAllowedDomain          = usecase.AddAllowedDomain
	ApproveAccessRequest      = usecase.ApproveAccessRequest
	Build                     = usecase.Build
	BuildPageContentView      = usecase.BuildPageContentView
	CanEmailCodes             = usecase.CanEmailCodes
	ClaimInstance             = usecase.ClaimInstance
	ConsumePasswordResetToken = usecase.ConsumePasswordResetToken
	CreateKeypair             = usecase.CreateKeypair
	CreatePage                = usecase.CreatePage
	CreatePrompt              = usecase.CreatePrompt
	DefaultPageContent        = usecase.DefaultPageContent
	DeleteKeypair             = usecase.DeleteKeypair
	DeletePage                = usecase.DeletePage
	DeletePrompt              = usecase.DeletePrompt
	EnsureUnclaimedSetupToken = usecase.EnsureUnclaimedSetupToken
	FirstOwner                = usecase.FirstOwner
	GenerateRecovery          = usecase.GenerateRecovery
	GetBuild                  = usecase.GetBuild
	GetOutputLanding          = usecase.GetOutputLanding
	GetPrompt                 = usecase.GetPrompt
	GetPublicPage             = usecase.GetPublicPage
	GetWikiLanding            = usecase.GetWikiLanding
	IndexedOutputLandings     = usecase.IndexedOutputLandings
	IndexedWikiLandings       = usecase.IndexedWikiLandings
	ListAllowedDomains        = usecase.ListAllowedDomains
	ListKeypairs              = usecase.ListKeypairs
	ListPages                 = usecase.ListPages
	ListPrompts               = usecase.ListPrompts
	LoadSoleOwner             = usecase.LoadSoleOwner
	Login                     = usecase.Login
	PinToPage                 = usecase.PinToPage
	PromoteToLive             = usecase.PromoteToLive
	PromoteToStaging          = usecase.PromoteToStaging
	PublicReady               = usecase.PublicReady
	Recover                   = usecase.Recover
	RemoveAllowedDomain       = usecase.RemoveAllowedDomain
	ResolveLiveBuild          = usecase.ResolveLiveBuild
	Rollback                  = usecase.Rollback
	SetOwnerCSS               = usecase.SetOwnerCSS
	SweepPagePins             = usecase.SweepPagePins
	UnpinFromPage             = usecase.UnpinFromPage
	UpdateBYOAI               = usecase.UpdateBYOAI
	UpdateOwnerAIProvider     = usecase.UpdateOwnerAIProvider
	UpdateOwnerEmail          = usecase.UpdateOwnerEmail
	UpdateOwnerFullName       = usecase.UpdateOwnerFullName
	UpdateOwnerHandle         = usecase.UpdateOwnerHandle
	UpdateOwnerPassword       = usecase.UpdateOwnerPassword
	UpdateOwnerPublicURL      = usecase.UpdateOwnerPublicURL
	UpdatePrompt              = usecase.UpdatePrompt
	UpdateWikiSEOWithPins     = usecase.UpdateWikiSEOWithPins
	ValidatePagePins          = usecase.ValidatePagePins
	VerifySigv1               = usecase.VerifySigv1
	WikiNodeContext           = usecase.WikiNodeContext
	WikiTreeChildren          = usecase.WikiTreeChildren
	WikiTreeScopeFor          = usecase.WikiTreeScopeFor
	WikiTreeStats             = usecase.WikiTreeStats
	WriteFile                 = usecase.WriteFile
)

// 常量（实现:usecase）.
const (
	KeyClear = usecase.KeyClear
	KeyKeep  = usecase.KeyKeep
	KeySet   = usecase.KeySet
)

// 错误/变量（实现:usecase）.
var (
	CancelBooking       = usecase.CancelBooking
	CancelOwnBooking    = usecase.CancelOwnBooking
	ErrPasswordTooShort = usecase.ErrPasswordTooShort
	ErrPublicURLInvalid = usecase.ErrPublicURLInvalid
)
