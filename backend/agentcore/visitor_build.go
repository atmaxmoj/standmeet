// visitor_build.go —— P.13: the standalone-launch handle. BuildVisitorAgent drives
// the SAME real visitor capability assembly the HTTP path runs (RegisterVisitorSkills
// + AssembleVisitor + ComposeSystemPrompt) — but takes its environment from an
// injected agentcore.Driver instead of postgres/connectors. prod plugs in a real
// Driver; eval-harness plugs in a canned one. No fixture lives here: the Driver IS the
// environment, the bridge (bridge.go) adapts it onto the real internal ports.
//
// The system prompt is the experiment injection point: leave SystemPromptOverride
// empty for the faithful composed prompt (ComposeBasePersona + capability fragments),
// or set it to try a variant. The core runs whatever prompt you hand it — that's the
// "trial a good prompt → backfill into prod" mechanism, parallelizable across processes.

package agentcore

import (
	"context"
	"errors"
	"fmt"

	"github.com/cloudwego/eino/components/tool"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
	conversation "github.com/atmaxmoj/standmeet/internal/conversation/facade"
	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
	marketplace "github.com/atmaxmoj/standmeet/internal/marketplace/facade"
	"github.com/atmaxmoj/standmeet/internal/routes/capload"
)

// evalSkillID / evalMCPID —— fixed grant ids the launch RoleSnapshot references when
// the Driver grants a skill / ext-mcp server.
const (
	evalSkillID = "eval-skill"
	evalMCPID   = "eval-mcp"
)

// VisitorAgent —— the assembled, transport-agnostic visitor agent: the real tools +
// composed prompt, ready to feed into an AgentTurnInput and RunAgentLoop.
type VisitorAgent struct {
	Labels         map[string]string
	ReturnDirectly map[string]bool
	SystemPrompt   string
	Tools          []tool.BaseTool
}

// BuildVisitorAgent —— assemble the real visitor agent over the injected Driver. The
// Driver supplies the environment (persona/corpus, skill + its execution, ext-mcp,
// cred); LaunchInput supplies the per-run framing. Returns the real tools + composed
// prompt; makes no LLM call (assembly only).
func BuildVisitorAgent(ctx context.Context, d Driver, in *LaunchInput) (*VisitorAgent, error) {
	if d == nil {
		return nil, errors.New("agentcore: BuildVisitorAgent needs a Driver")
	}
	if in == nil {
		return nil, errors.New("agentcore: BuildVisitorAgent needs a LaunchInput")
	}
	env, eerr := fetchDriverEnv(ctx, d)
	if eerr != nil {
		return nil, eerr
	}

	snapshot := buildSnapshot(&snapshotInput{
		roleBody: env.persona.RoleBody, corpusURIs: buildCorpusGrants(env.persona.Corpus),
		skill: env.skill, mcpURL: env.mcpURL, granted: in.GrantedCapabilities,
	})
	deps := buildDriverDeps(d, in.OwnerID, env.skill, env.mcpURL)

	reg := capreg.NewRegistry()
	capload.RegisterVisitorSkills(reg, deps, nil)
	registerDriverPlugins(reg, env.plugins)

	assemble := &capreg.AssembleInput{
		RoleSnapshot:   &snapshot,
		OwnerID:        in.OwnerID,
		Mode:           in.Mode,
		ConversationID: in.ConversationID,
		Subject:        capreg.Subject{Kind: capreg.SubjectCode, ID: in.CodeID},
	}
	fr := capreg.FlattenBindings(reg.AssembleVisitor(ctx, assemble))
	return &VisitorAgent{
		SystemPrompt: composePrompt(ctx, reg, assemble, &promptSource{
			snapshot: &snapshot, ownerName: env.persona.OwnerName,
			override: in.SystemPromptOverride,
		}),
		Tools:          fr.Tools,
		Labels:         fr.Labels,
		ReturnDirectly: fr.ReturnDirectly,
	}, nil
}

// driverEnv —— the launch environment pulled off the Driver in one shot.
type driverEnv struct {
	skill   *VisitorSkillSpec
	plugins []PluginSpec
	mcpURL  string
	persona Persona
}

// fetchDriverEnv —— pull the launch environment off the Driver (persona, granted skill,
// ext-mcp URL, plugins); first error wins, wrapped for context.
func fetchDriverEnv(ctx context.Context, d Driver) (driverEnv, error) {
	persona, perr := d.Persona(ctx)
	if perr != nil {
		return driverEnv{}, fmt.Errorf("driver persona: %w", perr)
	}
	skill, serr := d.Skill(ctx)
	if serr != nil {
		return driverEnv{}, fmt.Errorf("driver skill: %w", serr)
	}
	mcpURL, merr := d.ExtMCPURL(ctx)
	if merr != nil {
		return driverEnv{}, fmt.Errorf("driver ext-mcp: %w", merr)
	}
	plugins, plerr := d.Plugins(ctx)
	if plerr != nil {
		return driverEnv{}, fmt.Errorf("driver plugins: %w", plerr)
	}
	return driverEnv{persona: persona, skill: skill, mcpURL: mcpURL, plugins: plugins}, nil
}

// promptSource —— where this launch's persona comes from (packed to keep the
// argument count down): the role framing, who the owner is, and the experiment
// override that replaces both when set.
type promptSource struct {
	snapshot  *access.RoleSnapshot
	ownerName string
	override  string
}

// composePrompt —— the override IS the prompt when set (experiment injection);
// otherwise compose the faithful prod prompt (base persona + capability fragments).
func composePrompt(
	ctx context.Context, reg *capreg.Registry,
	in *capreg.AssembleInput, src *promptSource,
) string {
	if src.override != "" {
		return src.override
	}
	base := conversation.ComposeBasePersona(src.snapshot, src.ownerName)
	return reg.ComposeSystemPrompt(ctx, base, in)
}

// buildSnapshot —— RoleSnapshot framing the run: PromptBody is the owner persona;
// CorpusURIs are the granted (public) entry URIs (turn retrieval on + gate ACL); a
// granted skill adds its id + prompt; a non-empty mcpURL adds its server id.
// snapshotInput — buildSnapshot's argument struct (packed to stay under the
// argument-limit).
type snapshotInput struct {
	skill      *VisitorSkillSpec
	roleBody   string
	mcpURL     string
	corpusURIs []string
	granted    []string
}

func buildSnapshot(in *snapshotInput) access.RoleSnapshot {
	init := &access.RoleSnapshotInit{
		RoleID:     "eval-role",
		RoleName:   "eval",
		PromptBody: in.roleBody,
		CorpusURIs: in.corpusURIs,
		// AllowedTools — the capability ids the role has granted. acl=role_granted
		// plugins are exposed through this.
		AllowedTools: in.granted,
	}
	if in.skill != nil {
		init.SkillIDs = []string{evalSkillID}
		if in.skill.Prompt != "" {
			init.SkillPrompts = []string{in.skill.Prompt}
		}
	}
	if in.mcpURL != "" {
		init.MCPServerIDs = []string{evalMCPID}
	}
	return access.NewRoleSnapshot(init)
}

// buildDriverDeps —— VisitorSkillsDeps with only the ports the assembled capabilities
// touch, each backed by the Driver: skill-runner (Skills + Sandbox) when a skill is
// granted, ext-mcp (MCPServers) when a server is granted, plus the Resolver. The other
// ports stay nil — their capabilities grant-gate to ErrHidden, same as for an owner
// who wired nothing.
func buildDriverDeps(
	d Driver, ownerID string, skill *VisitorSkillSpec, mcpURL string,
) *conversation.VisitorSkillsDeps {
	deps := &conversation.VisitorSkillsDeps{Resolver: driverResolver{driver: d}}
	if skill != nil {
		sk := buildSkillFromSpec(ownerID, skill)
		deps.Skills = driverSkillGetter{skill: &sk}
		deps.Sandbox = driverSandbox{driver: d}
	}
	if mcpURL != "" {
		cfg := marketplace.DialableMCPServer{
			ID: evalMCPID, OwnerID: ownerID, Name: "eval-mcp", URL: mcpURL,
		}
		deps.MCPServers = driverMCPGetter{cfg: &cfg}
	}
	return deps
}

// buildCorpusGrants —— public corpus entries → granted CorpusURI whitelist. Privacy is
// code-level: a Private entry's URI is omitted, so the ACL denies it at search/read/list
// no matter what the prompt says. URIs are FormatURI(genre, entry.Path) — the same path
// the Driver's corpus ops report, so a granted entry actually matches at retrieval time.
func buildCorpusGrants(entries []VisitorCorpusEntry) []string {
	uris := make([]string, 0, len(entries))
	for i := range entries {
		e := &entries[i]
		if e.Private {
			continue
		}
		genre := corpus.GenreWiki
		if e.Genre == "output" {
			genre = corpus.GenreOutput
		}
		uris = append(uris, corpus.FormatURI(genre, e.Path))
	}
	return uris
}
