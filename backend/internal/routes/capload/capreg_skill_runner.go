// capreg_skill_runner.go —— Phase C: skillRunnerCapability（faithful Agent
// Skills + progressive disclosure）。
//
// role 授权且 enabled 的 skill 只把 name+description 进系统提示（L1，见
// visitor_role_snapshot.collectRoleSkillBundle）。这个 capability 暴露**两个
// 通用 tool**（替换旧的「每脚本一 tool」eager 模型）：
//
//   • skill_use({name})          —— L2：把该 skill render 成标准 SKILL.md
//                                   （frontmatter name+description + body）回给
//                                   agent 按需读正文。
//   • skill_run_script({name,     —— L3：正文引用的脚本经 sandbox.Runner 按需
//      script,args})                跑，只回 stdout/stderr/exit_code。
//
// 一个 capability、两个 tool。role 含 ≥1 enabled skill → enabled；否则 ErrHidden。
// per-skill ACL 在 tool 内做：name 不在本 session 授权集 → 回错误，绝不披露。
// Shape=visitor_only；owner 没必要通过 MCP 调自己的 skill。

package capload

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
	"github.com/atmaxmoj/standmeet/internal/capabilities/sandbox"
	"github.com/atmaxmoj/standmeet/internal/conversation"
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

// skillRunnerDeps —— 窄依赖(#131):owner skill 目录 + 跑脚本的 sandbox。
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
	// L1（name+description）走 ComposeBasePersona 的 SkillPrompts 通道注入，
	// 不在这里;capability fragment 留空避免重复。
	return ""
}

func (*skillRunnerCapability) SystemPromptFragmentID(
	_ context.Context, _ *capreg.AssembleInput,
) string {
	return ""
}

// VisitorBinding —— role 含 ≥1 enabled skill → 暴露 skill_use + skill_run_script
// 两个通用 tool;否则 ErrHidden（capability 隐藏）。
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

// loadSkillsForBinding —— 按 snapshot.SkillIDs（已是 enabled-granted）加载 skill
// 全量（含 body + scripts），供两个 tool 内查 name。已删 skill id（race）→ skip。
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
			continue // race: skill deleted after session issue
		}
		out = append(out, s)
	}
	return out
}

// skillsByName —— name → *skill（指针指进 slice，调用期不再改 slice）。
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

// parseSkillName —— 解 {name}（bool 返回避免 nilerr：解析失败不当 Go error，
// 由 caller 折成 tool-result envelope）。
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

// renderSkillMD —— DB skill row → 标准 Anthropic Agent Skills 的 SKILL.md
// （YAML frontmatter: name + description；正文 = body；脚本清单附后）。这是
// P.1e 的「render 成 SKILL.md 喂 runtime」—— DB 仍是管理存储，喂给 agent 的是
// SKILL.md。
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

// renderSkillScriptsSection —— 正文末尾列出可跑脚本，引导 agent 用
// skill_run_script(name, script) 调它们（L3）。无脚本则空。
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

// runScriptArgs —— skill_run_script 的入参。
type runScriptArgs struct {
	Name   string          `json:"name"`
	Script string          `json:"script"`
	Args   json.RawMessage `json:"args"`
}

// scriptArgsJSON —— 透传给 sandbox 的脚本 args；空 → "{}"。
func (r *runScriptArgs) scriptArgsJSON() string {
	s := strings.TrimSpace(string(r.Args))
	if s == "" {
		return "{}"
	}
	return s
}

// parseRunScriptArgs —— 解 {name,script,args}（bool 返回避免 nilerr）。
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

// skillRunToToolResult —— sandbox 错误折成 errJSON 进 tool_result，让 LLM
// 看到 "tool failed" 而不是 abort agent loop。
//
//nolint:nilerr // tool-result envelope: err 进 JSON text，Go err return nil
func skillRunToToolResult(r *sandbox.Result, err error) (string, error) {
	if err != nil {
		return errJSON("skill script: " + err.Error()), nil
	}
	return formatSkillRunResult(r), nil
}

// skillRunPayload —— sandbox 执行结果的 wire 形态。
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
