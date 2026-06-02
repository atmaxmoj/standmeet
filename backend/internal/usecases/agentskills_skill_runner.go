// agentskills_skill_runner.go —— Phase B-3: skillRunnerCapability。
// owner 在 admin 加的 skill (脚本 + parameter schema) 在 visitor session 装配
// 时被自动暴露成 LLM tool (skill_<name>_<script>)；执行走 sandbox.Run。
//
// 一个 capability，多个 tool (= role.SkillIDs 解算的所有 script)。Shape=
// visitor_only；owner 没必要通过 MCP 调自己的 skill。

package usecases

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"

	"github.com/atmaxmoj/standmeet/internal/agentskills"
	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/inference"
	"github.com/atmaxmoj/standmeet/internal/sandbox"
)

const (
	capSkillRunner  = "skill.runner"
	skillToolPrefix = "skill_"
	maxToolNameLen  = 64
)

var skillToolNameRe = regexp.MustCompile(`[^a-zA-Z0-9_-]`)

type skillRunnerCapability struct {
	deps *VisitorDeps
}

func newSkillRunnerCapability(deps *VisitorDeps) *skillRunnerCapability {
	return &skillRunnerCapability{deps: deps}
}

func (*skillRunnerCapability) ID() string { return capSkillRunner }
func (*skillRunnerCapability) Shape() agentskills.Shape {
	return agentskills.ShapeVisitorOnly
}

func (*skillRunnerCapability) OwnerMCPBindings() []*agentskills.MCPBinding {
	return []*agentskills.MCPBinding{}
}

func (*skillRunnerCapability) SystemPromptFragment(
	_ context.Context, _ *agentskills.AssembleInput,
) string {
	// Skill scripts 自带 description (在 tool spec)，prompt fragment 留空避免
	// 噪声。owner-curated skill prompt 走 ComposeBasePersona 的 SkillPrompts
	// 通道，不在这里。
	return ""
}

func (*skillRunnerCapability) SystemPromptFragmentID(
	_ context.Context, _ *agentskills.AssembleInput,
) string {
	return ""
}

// VisitorBinding —— 按 role.SkillIDs 加载 skill scripts，每个 script 绑一个
// tool；role 没挂 skill → 返 ErrHidden (capability 隐藏)。
//
// SkillIDs 含已删除 skill id (race，owner 删 skill 但已颁的 session 还引)
// → GetByID 返 err，silently skip 该 id。
func (c *skillRunnerCapability) VisitorBinding(
	ctx context.Context, in *agentskills.AssembleInput,
) (*agentskills.Binding, error) {
	skills := loadSkillsForBinding(ctx, c.deps, in)
	tools := buildSkillTools(c.deps.Sandbox, skills)
	if len(tools) == 0 {
		return nil, agentskills.ErrHidden
	}
	return &agentskills.Binding{
		Tools: tools,
		State: agentskills.CapabilityState{ID: capSkillRunner, Enabled: true},
	}, nil
}

func loadSkillsForBinding(
	ctx context.Context, deps *VisitorDeps, in *agentskills.AssembleInput,
) []domain.Skill {
	if deps.Skills == nil || in.RoleSnapshot == nil {
		return []domain.Skill{}
	}
	ids := in.RoleSnapshot.SkillIDs()
	out := make([]domain.Skill, 0, len(ids))
	for _, id := range ids {
		s, err := deps.Skills.GetByID(ctx, in.OwnerID, id)
		if err != nil {
			continue // race: skill deleted after session issue
		}
		out = append(out, s)
	}
	return out
}

func buildSkillTools(runner sandbox.Runner, skills []domain.Skill) []agentskills.BindingTool {
	totalScripts := 0
	for i := range skills {
		totalScripts += len(skills[i].Scripts)
	}
	out := make([]agentskills.BindingTool, 0, totalScripts)
	for i := range skills {
		out = append(out, skillBindingTools(runner, &skills[i])...)
	}
	return out
}

func skillBindingTools(runner sandbox.Runner, s *domain.Skill) []agentskills.BindingTool {
	out := make([]agentskills.BindingTool, 0, len(s.Scripts))
	for j := range s.Scripts {
		script := &s.Scripts[j]
		toolName := composeSkillToolName(s.Name, script.Filename)
		if toolName == "" {
			continue
		}
		out = append(out, agentskills.BindingTool{
			Spec: inference.ToolSpec{
				Name:          toolName,
				Description:   skillToolDescription(s, script),
				ProgressLabel: "running owner skill",
				InputSchema:   skillScriptInputSchema(script),
			},
			Execute: makeSkillExecutor(runner, script),
		})
	}
	return out
}

// composeSkillToolName —— 规范化 skill_<skill>_<script-stem> 给 LLM。
// 非法字符 (含 `.`) 替成 `_`，超长截到 maxToolNameLen。
func composeSkillToolName(skillName, filename string) string {
	stem := strings.TrimSuffix(filename, fileExt(filename))
	raw := skillToolPrefix + skillName + "_" + stem
	clean := skillToolNameRe.ReplaceAllString(raw, "_")
	if len(clean) > maxToolNameLen {
		clean = clean[:maxToolNameLen]
	}
	return clean
}

func fileExt(filename string) string {
	if idx := strings.LastIndex(filename, "."); idx >= 0 {
		return filename[idx:]
	}
	return ""
}

func skillToolDescription(s *domain.Skill, script *domain.SkillScript) string {
	if script.Description != "" {
		return script.Description
	}
	return fmt.Sprintf("Run %s script %q (skill %q).", script.Language, script.Filename, s.Name)
}

func skillScriptInputSchema(script *domain.SkillScript) json.RawMessage {
	if len(script.Parameters) == 0 {
		return json.RawMessage(`{"type":"object","properties":{}}`)
	}
	schema := buildScriptSchema(script.Parameters)
	raw, err := json.Marshal(schema)
	if err != nil {
		return json.RawMessage(`{"type":"object","properties":{}}`)
	}
	return raw
}

type scriptSchema struct {
	Type       string                 `json:"type"`
	Properties map[string]paramSchema `json:"properties"`
	Required   []string               `json:"required,omitempty"`
}

type paramSchema struct {
	Type        string `json:"type"`
	Description string `json:"description,omitempty"`
}

func buildScriptSchema(params []domain.SkillScriptParam) scriptSchema {
	props := make(map[string]paramSchema, len(params))
	required := make([]string, 0, len(params))
	for i := range params {
		p := &params[i]
		props[p.Name] = scriptParamSchema(p)
		if p.Required {
			required = append(required, p.Name)
		}
	}
	return scriptSchema{Type: "object", Properties: props, Required: required}
}

func scriptParamSchema(p *domain.SkillScriptParam) paramSchema {
	t := p.Type
	if t == "" {
		t = "string"
	}
	return paramSchema{Type: t, Description: p.Description}
}

func makeSkillExecutor(runner sandbox.Runner, script *domain.SkillScript) inference.ToolExecutor {
	language := script.Language
	content := script.Content
	return func(ctx context.Context, _ string, input []byte) (string, error) {
		result, err := runner.Run(ctx, &sandbox.RunInput{
			Language: language,
			Script:   content,
			ArgsJSON: string(input),
		})
		return skillRunToToolResult(&result, err)
	}
}

// skillRunToToolResult —— sandbox 错误折成 errJSON 进 tool_result，让 LLM
// 看到 "tool failed" 而不是 abort agent loop。
//
// 故意 nil 让 inference SDK 继续 agent loop 而不 abort 整个 stream。
//
//nolint:nilerr // tool-result envelope: err 进 JSON text，Go err return
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
