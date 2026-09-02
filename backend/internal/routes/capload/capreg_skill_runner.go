// capreg_skill_runner.go —— Phase C: skillRunnerCapability (faithful Agent
// Skills + progressive disclosure).
//
// A skill that's role-granted and enabled only puts name+description into the system
// prompt (L1, see visitor_role_snapshot.collectRoleSkillBundle). This capability exposes
// **two generic tools** (replacing the old "one tool per script" eager model):
//
//   • skill_use({name})          —— L2: renders the skill as a standard SKILL.md
//                                   (frontmatter name+description + body) and returns
//                                   it to the agent to read its body on demand.
//   • skill_run_script({name,     —— L3: a script referenced by the body is run on
//      script,args})                demand via sandbox.Runner, returning only
//                                   stdout/stderr/exit_code.
//
// One capability, two tools. Role contains ≥1 enabled skill → enabled; otherwise
// ErrHidden. Per-skill ACL is enforced inside the tool: a name not in this session's
// granted set → returns an error, and never reveals it exists. Shape=visitor_only; the
// owner has no need to call their own skill through MCP.

package capload

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
	"github.com/atmaxmoj/standmeet/internal/capabilities/sandbox"
	conversation "github.com/atmaxmoj/standmeet/internal/conversation/facade"
	marketplace "github.com/atmaxmoj/standmeet/internal/marketplace/facade"
)

const (
	capSkillRunner     = "skill.runner"
	toolSkillUse       = "skill_use"
	toolSkillRunScript = "skill_run_script"
)

const skillUseSchema = `{"type":"object","properties":{` +
	`"name":{"type":"string","description":"name of the skill to read"}},` +
	`"required":["name"]}`

const skillRunScriptSchema = `{"type":"object","properties":{` +
	`"name":{"type":"string","description":"name of the skill"},` +
	`"script":{"type":"string","description":"script filename within the skill (e.g. run.sh)"},` +
	`"args":{"type":"object","description":"arguments passed to the script as JSON"}},` +
	`"required":["name","script"]}`

// skillRunnerDeps —— narrow deps (#131): the owner's skill directory + the sandbox that
// runs scripts.
type skillRunnerDeps struct {
	Skills  conversation.SkillGetter
	Sandbox sandbox.Runner
}

type skillRunnerCapability struct {
	deps skillRunnerDeps
}

func newSkillRunnerCapability(deps skillRunnerDeps) *skillRunnerCapability {
	return &skillRunnerCapability{deps: deps}
}

func (*skillRunnerCapability) ID() string { return capSkillRunner }
func (*skillRunnerCapability) Shape() capreg.Shape {
	return capreg.ShapeVisitorOnly
}

func (*skillRunnerCapability) OwnerMCPBindings() []*capreg.MCPBinding {
	return []*capreg.MCPBinding{}
}

func (*skillRunnerCapability) SystemPromptFragment(
	_ context.Context, _ *capreg.AssembleInput,
) string {
	// L1 (name+description) is injected through ComposeBasePersona's SkillPrompts
	// channel, not here; the capability fragment stays empty to avoid duplication.
	return ""
}

func (*skillRunnerCapability) SystemPromptFragmentID(
	_ context.Context, _ *capreg.AssembleInput,
) string {
	return ""
}

// VisitorBinding —— role contains ≥1 enabled skill → exposes the two generic tools
// skill_use + skill_run_script; otherwise ErrHidden (the capability is hidden).
func (c *skillRunnerCapability) VisitorBinding(
	ctx context.Context, in *capreg.AssembleInput,
) (*capreg.Binding, error) {
	skills := loadSkillsForBinding(ctx, c.deps.Skills, in)
	if len(skills) == 0 {
		return nil, capreg.ErrHidden
	}
	tools := []capreg.BindingTool{
		capreg.NewTool(
			toolSkillUse,
			"Read the full SKILL.md instructions of one of the skills listed in your "+
				"system prompt. Call this when a skill's name/description looks relevant, "+
				"before acting on it.",
			"reading skill",
			json.RawMessage(skillUseSchema),
			makeSkillUse(skills),
		),
		capreg.NewTool(
			toolSkillRunScript,
			"Run a bundled script of a skill inside a sandbox and get its stdout/stderr/"+
				"exit code. Read the skill with skill_use first to learn which scripts it has.",
			"running skill script",
			json.RawMessage(skillRunScriptSchema),
			makeSkillRunScript(c.deps.Sandbox, skills),
		),
	}
	return &capreg.Binding{
		Tools: tools,
		State: capreg.CapabilityState{ID: capSkillRunner, Enabled: true},
	}, nil
}

// loadSkillsForBinding —— loads the full skill records (body + scripts included) by
// snapshot.SkillIDs (already enabled-granted), for the two tools to look up by name
// internally. A skill id that was deleted (a race) → skip.
func loadSkillsForBinding(
	ctx context.Context, skills conversation.SkillGetter, in *capreg.AssembleInput,
) []marketplace.Skill {
	if skills == nil || in.RoleSnapshot == nil {
		return []marketplace.Skill{}
	}
	ids := in.RoleSnapshot.SkillIDs()
	out := make([]marketplace.Skill, 0, len(ids))
	for _, id := range ids {
		s, err := skills.GetByID(ctx, in.OwnerID, id)
		if err != nil {
			continue // race: skill deleted after the session was issued
		}
		out = append(out, s)
	}
	return out
}

// skillsByName —— name → *skill (the pointer points into the slice; the slice is not
// mutated after this call).
func skillsByName(skills []marketplace.Skill) map[string]*marketplace.Skill {
	m := make(map[string]*marketplace.Skill, len(skills))
	for i := range skills {
		m[skills[i].Name] = &skills[i]
	}
	return m
}

// ─── L2: skill_use ───────────────────────────────────────────────

func makeSkillUse(skills []marketplace.Skill) capreg.RunFn {
	byName := skillsByName(skills)
	return func(_ context.Context, argsJSON string) (string, error) {
		name, ok := parseSkillName(argsJSON)
		if !ok {
			return errJSON("invalid arguments"), nil
		}
		s, found := byName[name]
		if !found {
			return errJSON(fmt.Sprintf("skill %q is not available in this session", name)), nil
		}
		return skillUsePayload(s), nil
	}
}

// parseSkillName —— parses {name} (returns bool to avoid nilerr: a parse failure is not
// treated as a Go error, and is folded by the caller into the tool-result envelope).
func parseSkillName(argsJSON string) (string, bool) {
	var a struct {
		Name string `json:"name"`
	}
	if err := json.Unmarshal([]byte(argsJSON), &a); err != nil {
		return "", false
	}
	return a.Name, true
}

func skillUsePayload(s *marketplace.Skill) string {
	out, err := json.Marshal(map[string]string{"skill_md": renderSkillMD(s)})
	if err != nil {
		return errJSON("marshal skill failed")
	}
	return string(out)
}

// renderSkillMD —— a DB skill row → a standard Anthropic Agent Skills SKILL.md (YAML
// frontmatter: name + description; body = body; a script list appended after). This is
// P.1e's "render into SKILL.md to feed the runtime" — the DB remains the management
// store, but what's fed to the agent is SKILL.md.
func renderSkillMD(s *marketplace.Skill) string {
	lines := []string{"---", "name: " + s.Name}
	if d := strings.TrimSpace(s.Description); d != "" {
		lines = append(lines, "description: "+d)
	}
	lines = append(lines, "---", "", strings.TrimSpace(s.Prompt))
	if scripts := renderSkillScriptsSection(s); scripts != "" {
		lines = append(lines, "", scripts)
	}
	return strings.Join(lines, "\n") + "\n"
}

// renderSkillScriptsSection —— lists the runnable scripts at the end of the body,
// directing the agent to call them via skill_run_script(name, script) (L3). Empty if
// there are no scripts.
func renderSkillScriptsSection(s *marketplace.Skill) string {
	if len(s.Scripts) == 0 {
		return ""
	}
	lines := []string{
		"## Scripts",
		"Run with skill_run_script(name=" + s.Name + ", script=<filename>):",
	}
	for i := range s.Scripts {
		sc := &s.Scripts[i]
		line := "- `" + sc.Filename + "` (" + sc.Language + ")"
		if d := strings.TrimSpace(sc.Description); d != "" {
			line += " — " + d
		}
		lines = append(lines, line)
	}
	return strings.Join(lines, "\n")
}

// ─── L3: skill_run_script ────────────────────────────────────────

// runScriptArgs —— skill_run_script's input arguments.
type runScriptArgs struct {
	Name   string          `json:"name"`
	Script string          `json:"script"`
	Args   json.RawMessage `json:"args"`
}

// scriptArgsJSON —— the script args passed through to the sandbox verbatim; empty →
// "{}".
func (r *runScriptArgs) scriptArgsJSON() string {
	s := strings.TrimSpace(string(r.Args))
	if s == "" {
		return "{}"
	}
	return s
}

// parseRunScriptArgs —— parses {name,script,args} (returns bool to avoid nilerr).
func parseRunScriptArgs(argsJSON string) (runScriptArgs, bool) {
	var a runScriptArgs
	if err := json.Unmarshal([]byte(argsJSON), &a); err != nil {
		return runScriptArgs{}, false
	}
	return a, true
}

func makeSkillRunScript(runner sandbox.Runner, skills []marketplace.Skill) capreg.RunFn {
	byName := skillsByName(skills)
	return func(ctx context.Context, argsJSON string) (string, error) {
		a, ok := parseRunScriptArgs(argsJSON)
		if !ok {
			return errJSON("invalid arguments"), nil
		}
		s, found := byName[a.Name]
		if !found {
			return errJSON(fmt.Sprintf("skill %q is not available in this session", a.Name)), nil
		}
		script := findSkillScript(s, a.Script)
		if script == nil {
			return errJSON(fmt.Sprintf("skill %q has no script %q", a.Name, a.Script)), nil
		}
		result, err := runner.Run(ctx, &sandbox.RunInput{
			Language: script.Language, Script: script.Content, ArgsJSON: a.scriptArgsJSON(),
		})
		return skillRunToToolResult(&result, err)
	}
}

func findSkillScript(s *marketplace.Skill, filename string) *marketplace.SkillScript {
	for i := range s.Scripts {
		if s.Scripts[i].Filename == filename {
			return &s.Scripts[i]
		}
	}
	return nil
}

// skillRunToToolResult —— folds a sandbox error into errJSON inside tool_result, so the
// LLM sees "tool failed" instead of the agent loop aborting.
//
//nolint:nilerr // tool-result envelope: err goes into the JSON text, Go err return nil
func skillRunToToolResult(r *sandbox.Result, err error) (string, error) {
	if err != nil {
		return errJSON("skill script: " + err.Error()), nil
	}
	return formatSkillRunResult(r), nil
}

// skillRunPayload —— the wire shape of a sandbox execution result.
type skillRunPayload struct {
	Stdout   string `json:"stdout"`
	Stderr   string `json:"stderr"`
	ExitCode int    `json:"exit_code"`
	TimedOut bool   `json:"timed_out"`
}

func formatSkillRunResult(r *sandbox.Result) string {
	out, err := json.Marshal(skillRunPayload{
		Stdout: r.Stdout, Stderr: r.Stderr,
		ExitCode: r.ExitCode, TimedOut: r.TimedOut,
	})
	if err != nil {
		return errJSON("marshal result failed")
	}
	return string(out)
}
