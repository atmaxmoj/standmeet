// bridge.go —— P.13: adapts ANY agentcore.Driver onto the real internal capability
// ports (sandbox.Runner / SkillGetter / MCPServerGetter / inference.Resolver). Each
// adapter holds a Driver and DELEGATES — it carries no canned data of its own, so
// these are the shared prod+eval bridge, NOT fixtures (check-no-mock stays green).
// The canned behaviour lives entirely in the caller's Driver (eval-harness EvalDriver).

package agentcore

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/capabilities/sandbox"
	"github.com/atmaxmoj/standmeet/internal/conversation/inference"
	marketplace "github.com/atmaxmoj/standmeet/internal/marketplace/facade"
)

// driverSandbox —— sandbox.Runner backed by Driver.RunSkill. Owns no stdout; forwards
// to whatever Driver is plugged in (prod = real sandbox, eval = canned stdout).
type driverSandbox struct{ driver Driver }

func (s driverSandbox) Run(ctx context.Context, in *sandbox.RunInput) (sandbox.Result, error) {
	out, err := s.driver.RunSkill(ctx, SkillRun{
		Language: in.Language, Script: in.Script, ArgsJSON: in.ArgsJSON,
	})
	if err != nil {
		return sandbox.Result{}, fmt.Errorf("driver run skill: %w", err)
	}
	return sandbox.Result{Stdout: out.Stdout, Stderr: out.Stderr, ExitCode: out.ExitCode}, nil
}

// driverSkillGetter —— SkillGetter over the Driver's one granted skill (already
// translated to a marketplace.Skill by the bridge).
type driverSkillGetter struct{ skill *marketplace.Skill }

func (g driverSkillGetter) GetByID(_ context.Context, _, _ string) (marketplace.Skill, error) {
	return *g.skill, nil
}

func (g driverSkillGetter) ListSkillsForRole(
	_ context.Context, _ string) ([]marketplace.Skill, error,
) {
	return []marketplace.Skill{*g.skill}, nil
}

// driverMCPGetter —— MCPServerGetter returning the Driver's one ext-mcp server config.
type driverMCPGetter struct{ cfg *marketplace.MCPServerConfig }

func (g driverMCPGetter) GetByID(
	_ context.Context, _, _ string) (marketplace.MCPServerConfig, error,
) {
	return *g.cfg, nil
}

// driverResolver —— inference.Resolver backed by Driver.Resolve.
type driverResolver struct{ driver Driver }

func (r driverResolver) Resolve(
	ctx context.Context, _ *inference.ResolveInput,
) (*inference.Cred, error) {
	c, err := r.driver.Resolve(ctx)
	if err != nil {
		return nil, fmt.Errorf("driver resolve: %w", err)
	}
	return &c, nil // agentcore.Cred is an alias of inference.Cred
}

// buildSkillFromSpec —— map a public VisitorSkillSpec into a marketplace.Skill with one
// script (the bridge translation; no canned data of its own).
func buildSkillFromSpec(ownerID string, spec *VisitorSkillSpec) marketplace.Skill {
	params := make([]marketplace.SkillScriptParam, 0, len(spec.Params))
	for i := range spec.Params {
		params = append(params, marketplace.SkillScriptParam{
			Name: spec.Params[i].Name, Type: spec.Params[i].Type,
			Description: spec.Params[i].Description, Required: spec.Params[i].Required,
		})
	}
	return marketplace.Skill{
		ID: evalSkillID, OwnerID: ownerID, Name: spec.Name,
		Description: spec.Description, Prompt: spec.Prompt,
		Scripts: []marketplace.SkillScript{{
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
