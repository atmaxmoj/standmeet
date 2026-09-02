package conversation

import "github.com/atmaxmoj/standmeet/internal/conversation/usecase"

// Types (impl: usecase).
type (
	APIKeyDenialReader = usecase.APIKeyDenialReader
	CodeIntroResult    = usecase.CodeIntroResult
	ConvDialog         = usecase.ConvDialog
	// ConvEvent -- something that happened during this conversation (a cancel on the card,
	// sending a confirmation letter), F-B-9.
	ConvEvent               = usecase.ConvEvent
	Conversation            = usecase.Conversation
	ConversationsDeps       = usecase.ConversationsDeps
	DialogCitation          = usecase.DialogCitation
	DialogCorpusLookup      = usecase.DialogCorpusLookup
	DialogDeps              = usecase.DialogDeps
	DialogGhost             = usecase.DialogGhost
	Getter                  = usecase.Getter
	GhostCandidate          = usecase.GhostCandidate
	GhostDeps               = usecase.GhostDeps
	IssueCodeSessionInput   = usecase.IssueCodeSessionInput
	IssueCodeSessionResult  = usecase.IssueCodeSessionResult
	IssuePublicSessionInput = usecase.IssuePublicSessionInput
	MCPServerGetter         = usecase.MCPServerGetter
	MarkWaypointsInput      = usecase.MarkWaypointsInput
	OpenConvForDocInput     = usecase.OpenConvForDocInput
	PolicyGhostInput        = usecase.PolicyGhostInput
	RecordDialogInput       = usecase.RecordDialogInput
	RecordGhostShownInput   = usecase.RecordGhostShownInput
	ReportStore             = usecase.ReportStore
	SkillGetter             = usecase.SkillGetter
	SubjectivityRef         = usecase.SubjectivityRef
	TitledRef               = usecase.TitledRef
	TranscriptBundle        = usecase.TranscriptBundle
	GasGauge                = usecase.GasGauge
	GasQuotaInput           = usecase.GasQuotaInput
	TurnQuotaInput          = usecase.TurnQuotaInput
	VisitorSessionDeps      = usecase.VisitorSessionDeps
	VisitorSkillsDeps       = usecase.VisitorSkillsDeps
	VisitorView             = usecase.VisitorView
	WaypointLedger          = usecase.WaypointLedger
)

// Constructors/functions (impl: usecase).
var (
	AcceptGhost               = usecase.AcceptGhost
	BuildAPIKeyRoleSnapshot   = usecase.BuildAPIKeyRoleSnapshot
	BuildCrossConvDigest      = usecase.BuildCrossConvDigest
	BuildGhostContext         = usecase.BuildGhostContext
	ChatBelongsToMember       = usecase.ChatBelongsToMember
	CodeIntro                 = usecase.CodeIntro
	ComposeBasePersona        = usecase.ComposeBasePersona
	ComposeDynamicPersona     = usecase.ComposeDynamicPersona
	EnforceGasQuota           = usecase.EnforceGasQuota
	EnforceTurnQuota          = usecase.EnforceTurnQuota
	ForChat                   = usecase.ForChat
	GetConversationTranscript = usecase.GetConversationTranscript
	GhostTelemetry            = usecase.GhostTelemetry
	IsFullReportDocument      = usecase.IsFullReportDocument
	IssueCodeSession          = usecase.IssueCodeSession
	IssuePublicSession        = usecase.IssuePublicSession
	ListConversations         = usecase.ListConversations
	ListGhostsForConversation = usecase.ListGhostsForConversation
	LoadVisitorView           = usecase.LoadVisitorView
	NewWaypointLedger         = usecase.NewWaypointLedger
	OpenConversationForDoc    = usecase.OpenConversationForDoc
	ParseGhost                = usecase.ParseGhost
	RecordDialog              = usecase.RecordDialog
	// RecordCardEvent -- records what the visitor did on the sandboxed card into this
	// conversation (F-B-9).
	RecordCardEvent      = usecase.RecordCardEvent
	RecordGhostShown     = usecase.RecordGhostShown
	RecordPolicyGhost    = usecase.RecordPolicyGhost
	ReportStyledDocument = usecase.ReportStyledDocument
	SanitizeReportHTML   = usecase.SanitizeReportHTML
	SteeringCandidates   = usecase.SteeringCandidates
	UnvisitedWaypoints   = usecase.UnvisitedWaypoints
)

// Constants (impl: usecase).
const GhostPolicyPrompt = usecase.GhostPolicyPrompt
