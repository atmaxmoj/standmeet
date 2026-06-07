// visitor_build.go —— F.2: the eval facade's build entry. BuildVisitorAgent
// drives the SAME real visitor capability assembly the HTTP path runs —
// usecases.RegisterVisitorSkills (real capability constructors) + AssembleVisitor
// (real eino tools) + ComposeSystemPrompt (real prompt fragments) — but injects
// fixture data sources (visitor_fixtures.go) instead of postgres. The eval gets
// the real tools + real prompt; only the backing data differs.
//
// The system prompt is the injectable experiment point: leave SystemPromptOverride
// empty for the faithful composed prompt (ComposeBasePersona + capability
// fragments), or set it to try a variant. That's the "试出好 prompt → 回填 prod"
// mechanism — the core runs whatever prompt you hand it.

package agentcore

import (
	"context"
	"errors"

	"github.com/cloudwego/eino/components/tool"

	"github.com/atmaxmoj/standmeet/internal/agentskills"
	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/usecases"
)

// evalSkillID / evalMCPID —— fixed grant ids the eval RoleSnapshot references.
const (
	evalSkillID = "eval-skill"
	evalMCPID   = "eval-mcp"
)

// VisitorCorpusEntry —— one curated corpus entry, plain data (the eval module
// can't construct internal/domain types). Genre is "wiki" or "output". Private
// entries are withheld at the retrieval ACL layer (code-level, not prompt).
type VisitorCorpusEntry struct {
	Genre   string
	Path    string
	Title   string
	Body    string
	Tags    []string
	Private bool
}

// ConvMessage —— one turn of a fixture transcript for summarize_conversation.
// Role is "visitor" or "assistant".
type ConvMessage struct {
	Role string
	Body string
}

// BuildVisitorInput —— everything BuildVisitorAgent needs to assemble a visitor
// agent from fixtures.
//
// Booking: set EnableBooking with Mode "code" to expose calendar_book +
// calendar_list_slots over a canned calendar (prod hides the booker outside code
// mode, so this mirrors prod). CodeID + MaxBookings drive the per-code quota;
// BookingFailure ("notconnected" / "conflict") injects failure paths.
type BuildVisitorInput struct {
	Cred                 *Cred
	MaxBookings          *int32
	Skill                *VisitorSkillSpec
	OwnerID              string
	Mode                 string
	RoleBody             string
	SystemPromptOverride string
	ConversationID       string
	CodeID               string
	OwnerTimezone        string
	BookingFailure       string
	// MCPServerURL —— an owner-registered external MCP server. When set, ext-mcp
	// dials it for real and the agent gets its tools. Empty = ext-mcp hidden.
	MCPServerURL  string
	Corpus        []VisitorCorpusEntry
	Conversation  []ConvMessage
	EnableBooking bool
}

// VisitorAgent —— the assembled, transport-agnostic visitor agent: the real
// tools + composed prompt, ready to feed into an AgentTurnInput and RunAgentLoop.
type VisitorAgent struct {
	Labels         map[string]string
	ReturnDirectly map[string]bool
	SystemPrompt   string
	Tools          []tool.BaseTool
}

// BuildVisitorAgent —— assemble the real visitor agent over fixture data.
func BuildVisitorAgent(ctx context.Context, in *BuildVisitorInput) (*VisitorAgent, error) {
	if in.Cred == nil {
		return nil, errors.New("agentcore: BuildVisitorAgent needs a Cred")
	}
	corpus := buildCorpusFixtures(in.OwnerID, in.Corpus)
	snapshot := buildEvalSnapshot(in, corpus.corpusURIs)
	deps := buildEvalDeps(in, &corpus)

	reg := agentskills.NewRegistry()
	usecases.RegisterVisitorSkills(reg, deps, convFixture{
		msgs: toMessages(in.ConversationID, in.Conversation),
	})

	assemble := &agentskills.AssembleInput{
		RoleSnapshot:   &snapshot,
		OwnerID:        in.OwnerID,
		Mode:           in.Mode,
		ConversationID: in.ConversationID,
		CodeID:         in.CodeID,
		MaxBookings:    in.MaxBookings,
	}
	fr := agentskills.FlattenBindings(reg.AssembleVisitor(ctx, assemble))
	return &VisitorAgent{
		SystemPrompt:   composePrompt(ctx, reg, &snapshot, assemble, in.SystemPromptOverride),
		Tools:          fr.Tools,
		Labels:         fr.Labels,
		ReturnDirectly: fr.ReturnDirectly,
	}, nil
}

// composePrompt —— the override IS the prompt when set (experiment injection);
// otherwise compose the faithful prod prompt (base persona + capability fragments).
func composePrompt(
	ctx context.Context, reg *agentskills.Registry,
	snapshot *domain.RoleSnapshot, in *agentskills.AssembleInput, override string,
) string {
	if override != "" {
		return override
	}
	base := usecases.ComposeBasePersona(snapshot)
	return reg.ComposeSystemPrompt(ctx, base, in)
}

// buildEvalSnapshot —— RoleSnapshot framing the run: PromptBody is the owner
// persona (RoleBody); CorpusURIs are the granted (public) entry URIs, which both
// turn the retrieval capability on (retrievalEnabled = len>0) and gate ACL.
// EnableBooking adds calendar.book to AllowedTools (unlocks the booker + emits
// its fragment); Skill grants the skill id (+ surfaces its prompt) so skill-runner
// builds its tool; MCPServerURL grants the server id so ext-mcp dials it.
func buildEvalSnapshot(in *BuildVisitorInput, corpusURIs []string) domain.RoleSnapshot {
	init := &domain.RoleSnapshotInit{
		RoleID:     "eval-role",
		RoleName:   "eval",
		PromptBody: in.RoleBody,
		CorpusURIs: corpusURIs,
	}
	if in.EnableBooking {
		init.AllowedTools = []string{usecases.BookerSkillName}
	}
	if in.Skill != nil {
		init.SkillIDs = []string{evalSkillID}
		if in.Skill.Prompt != "" {
			init.SkillPrompts = []string{in.Skill.Prompt}
		}
	}
	if in.MCPServerURL != "" {
		init.MCPServerIDs = []string{evalMCPID}
	}
	return domain.NewRoleSnapshot(init)
}

// buildEvalDeps —— VisitorDeps with only the fields the registered capabilities
// touch: corpus listers (retrieval), Reports + Resolver (summarize), and — when
// EnableBooking — the canned calendar + owner so the booker assembles. Skills /
// MCPServers stay nil (their capabilities grant-gate to ErrHidden); Calendar
// stays nil when booking is off, so the booker hides exactly as for an owner who
// wired no connector.
func buildEvalDeps(in *BuildVisitorInput, corpus *corpusFixtures) *usecases.VisitorDeps {
	deps := &usecases.VisitorDeps{
		Wiki:     wikiFixture{items: corpus.wikis},
		Output:   outputFixture{items: corpus.outputs},
		Writings: writingFixture{},
		Reports:  noopReports{},
		Resolver: fixedResolver{cred: in.Cred},
	}
	if in.EnableBooking {
		deps.Calendar = cannedCalendarStore{failure: in.BookingFailure}
		deps.GCal = cannedCalendarClient{failure: in.BookingFailure}
		deps.Owners = ownerFixture{ownerID: in.OwnerID, tz: ownerTZ(in.OwnerTimezone)}
	}
	if in.Skill != nil {
		sk := buildEvalSkill(in.OwnerID, in.Skill)
		deps.Skills = skillFixture{skill: &sk}
		deps.Sandbox = cannedSandbox{stdout: in.Skill.Stdout}
	}
	if in.MCPServerURL != "" {
		cfg := domain.MCPServerConfig{
			ID: evalMCPID, OwnerID: in.OwnerID, Name: "eval-mcp", URL: in.MCPServerURL,
		}
		deps.MCPServers = mcpFixture{cfg: &cfg}
	}
	return deps
}

// ownerTZ —— default the owner timezone to UTC (a valid IANA zone the booking
// policy math can always load) when the caller leaves it empty.
func ownerTZ(tz string) string {
	if tz == "" {
		return "UTC"
	}
	return tz
}
