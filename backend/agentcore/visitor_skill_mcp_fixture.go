// visitor_skill_mcp_fixture.go —— F.2 (skill + ext-mcp): fixtures so the eval
// facade can load an owner-curated skill and an owner-registered external MCP
// server onto the visitor agent, to audit whether the agent DISCOVERS and
// INVOKES them.
//
// Skill: a canned sandbox.Runner (interface in prod) stands in for the real
// script executor, returning a fixed stdout — so the real skill-runner builds
// the real tool, the agent calls it, and we see the result, without a sandbox.
//
// MCP: the dial stays REAL — the ext-mcp capability dials the URL with the
// production mcpclient. Only the registry lookup (which server config a role
// granted) is fixtured. Point MCPServerURL at a running MCP server (e.g. the
// repo's mcp-server-mock on :9100/mcp).

package agentcore

import (
	"context"

	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/sandbox"
)

// VisitorSkillSpec —— an owner skill to load, plain data. Its single script
// becomes a tool the agent can call; the canned sandbox returns Stdout.
type VisitorSkillSpec struct {
	Name        string
	Description string
	Prompt      string // guidance surfaced to the agent (RoleSnapshot.SkillPrompts)
	Language    string // python | bash | javascript
	Content     string // script source (run by the canned sandbox)
	Stdout      string // what the canned sandbox returns for this script
	Params      []VisitorSkillParam
}

// VisitorSkillParam —— one input parameter of the skill script's tool schema.
type VisitorSkillParam struct {
	Name        string
	Type        string
	Description string
	Required    bool
}

// cannedSandbox —— sandbox.Runner returning a fixed stdout, so the skill tool's
// round-trip runs without executing real code.
type cannedSandbox struct{ stdout string }

func (s cannedSandbox) Run(_ context.Context, _ *sandbox.RunInput) (sandbox.Result, error) {
	return sandbox.Result{Stdout: s.stdout, ExitCode: 0}, nil
}

// skillFixture —— SkillGetter holding the one eval skill (by pointer so the
// value receiver stays light).
type skillFixture struct{ skill *domain.Skill }

func (f skillFixture) GetByID(_ context.Context, _, _ string) (domain.Skill, error) {
	return *f.skill, nil
}

func (f skillFixture) ListSkillsForRole(_ context.Context, _ string) ([]domain.Skill, error) {
	return []domain.Skill{*f.skill}, nil
}

// mcpFixture —— MCPServerGetter holding the one eval server config. The ext-mcp
// capability dials its URL for real.
type mcpFixture struct{ cfg *domain.MCPServerConfig }

func (f mcpFixture) GetByID(_ context.Context, _, _ string) (domain.MCPServerConfig, error) {
	return *f.cfg, nil
}

// buildEvalSkill —— map a VisitorSkillSpec into a domain.Skill with one script.
func buildEvalSkill(ownerID string, spec *VisitorSkillSpec) domain.Skill {
	params := make([]domain.SkillScriptParam, 0, len(spec.Params))
	for i := range spec.Params {
		params = append(params, domain.SkillScriptParam{
			Name: spec.Params[i].Name, Type: spec.Params[i].Type,
			Description: spec.Params[i].Description, Required: spec.Params[i].Required,
		})
	}
	return domain.Skill{
		ID: evalSkillID, OwnerID: ownerID, Name: spec.Name,
		Description: spec.Description, Prompt: spec.Prompt,
		Scripts: []domain.SkillScript{{
			Filename: spec.Name + scriptExt(spec.Language), Language: spec.Language,
			Content: spec.Content, Description: spec.Description, Parameters: params,
		}},
	}
}

// scriptExt —— filename extension for the script language (composeSkillToolName
// strips it; only needs to be non-empty + language-appropriate).
func scriptExt(language string) string {
	switch language {
	case "python":
		return ".py"
	case "javascript":
		return ".js"
	default:
		return ".sh"
	}
}
