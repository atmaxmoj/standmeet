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
type BuildVisitorInput struct {
	Cred                 *Cred
	OwnerID              string
	Mode                 string
	RoleBody             string
	SystemPromptOverride string
	ConversationID       string
	Corpus               []VisitorCorpusEntry
	Conversation         []ConvMessage
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
func buildEvalSnapshot(in *BuildVisitorInput, corpusURIs []string) domain.RoleSnapshot {
	return domain.NewRoleSnapshot(&domain.RoleSnapshotInit{
		RoleID:     "eval-role",
		RoleName:   "eval",
		PromptBody: in.RoleBody,
		CorpusURIs: corpusURIs,
	})
}

// buildEvalDeps —— VisitorDeps with only the fields the registered capabilities
// touch: corpus listers (retrieval), Reports + Resolver (summarize). Calendar /
// Skills / MCPServers stay nil — their capabilities grant-gate to ErrHidden, so
// they're hidden, exactly as for an owner who wired no connectors.
func buildEvalDeps(in *BuildVisitorInput, corpus *corpusFixtures) *usecases.VisitorDeps {
	return &usecases.VisitorDeps{
		Wiki:     wikiFixture{items: corpus.wikis},
		Output:   outputFixture{items: corpus.outputs},
		Writings: writingFixture{},
		Reports:  noopReports{},
		Resolver: fixedResolver{cred: in.Cred},
	}
}
