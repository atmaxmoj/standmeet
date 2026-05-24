// visitor_chat_skill_tools.go —— skill scripts 自动暴露成 visitor chat
// MCP-style tool。设计源自 legacy
// standmeet-server/gateway/src/runtime/skill-tools.ts。
//
// 每个 skill.scripts[i] → 一个 tool：
//   - 名字：normalize("skill_" + skill.name + "_" + script.filename_stem)
//   - description = script.description（owner 写）
//   - input_schema = JSON-schema derived from script.parameters
//   - 执行：sandbox.Run(language, content, ARGS=JSON.stringify(input))
//
// 沙箱失败 / disabled / unsupported language → tool_result 文本里返错误，
// AI 看到的是"tool ran but error"，自然 fallback 走别的路径。

package usecases

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"

	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/inference"
	"github.com/wangsijie/standmeet/internal/sandbox"
)

// buildSkillBundle —— 通过 conversation 反查 code，再拉 skill+scripts；
// 没 code (public/byoai tier) → 返空 bundle (Specs() 空，dispatcher 跳过)。
func buildSkillBundle(
	ctx context.Context, deps *VisitorDeps, in *SendMessageInput,
) (*skillToolBundle, error) {
	skills, lerr := loadSkillsForConversation(ctx, deps, in)
	if lerr != nil {
		return nil, lerr
	}
	return newSkillToolBundle(deps.Sandbox, skills), nil
}

func loadSkillsForConversation(
	ctx context.Context, deps *VisitorDeps, in *SendMessageInput,
) ([]domain.Skill, error) {
	if deps.Skills == nil {
		return nil, nil
	}
	conv, err := deps.Conv.GetConversation(ctx, in.OwnerID, in.ConversationID)
	if err != nil {
		return nil, fmt.Errorf("load conv for skills: %w", err)
	}
	if conv.CodeID == nil {
		return nil, nil
	}
	skills, err := deps.Skills.ListSkillsForCode(ctx, *conv.CodeID)
	if err != nil {
		return nil, fmt.Errorf("list skills for code: %w", err)
	}
	return skills, nil
}

// skillToolPrefix —— 所有 skill 派生 tool 用这个前缀，方便 dispatcher
// 区分 retrieval tool (search/read/list_corpus_entries) 跟 skill tool。
const skillToolPrefix = "skill_"

// skillToolBundle —— 一组 skill 对应的 tool specs + executor 状态。
// 字段顺序按 govet fieldalignment 排：map header (8B) → interface (16B)
// → slice (24B)。
type skillToolBundle struct {
	scripts map[string]boundScript
	runner  sandbox.Runner
	specs   []inference.ToolSpec
}

type boundScript struct {
	language string
	content  string
}

func newSkillToolBundle(runner sandbox.Runner, skills []domain.Skill) *skillToolBundle {
	b := &skillToolBundle{
		runner:  runner,
		scripts: map[string]boundScript{},
	}
	for i := range skills {
		b.bindSkill(&skills[i])
	}
	return b
}

// Specs —— provider 看到的 tool 列表。可能为空。
func (b *skillToolBundle) Specs() []inference.ToolSpec { return b.specs }

// Has —— dispatcher 判断 tool name 是否属于 skill bundle。
func (b *skillToolBundle) Has(name string) bool {
	_, ok := b.scripts[name]
	return ok
}

// Execute —— inference.ToolExecutor 实现。input 直接当 ARGS 喂沙箱
// （owner 脚本自己解析 JSON）。
func (b *skillToolBundle) Execute(
	ctx context.Context, name string, input []byte,
) (string, error) {
	script, ok := b.scripts[name]
	if !ok {
		return "", fmt.Errorf("unknown skill tool: %s", name)
	}
	result, err := b.runner.Run(ctx, &sandbox.RunInput{
		Language: script.language,
		Script:   script.content,
		ArgsJSON: string(input),
	})
	if err != nil {
		return formatSkillRunErr(err), nil
	}
	return formatSkillRunResult(&result), nil
}

func (b *skillToolBundle) bindSkill(s *domain.Skill) {
	for i := range s.Scripts {
		toolName := composeSkillToolName(s.Name, s.Scripts[i].Filename)
		if toolName == "" {
			continue
		}
		schema := skillScriptInputSchema(&s.Scripts[i])
		b.specs = append(b.specs, inference.ToolSpec{
			Name:        toolName,
			Description: skillToolDescription(s, &s.Scripts[i]),
			InputSchema: schema,
		})
		b.scripts[toolName] = boundScript{
			language: s.Scripts[i].Language,
			content:  s.Scripts[i].Content,
		}
	}
}

func formatSkillRunErr(err error) string {
	return errJSON("skill script: " + err.Error())
}

// skillRunPayload —— sandbox 执行结果的 wire 形态。caller (AI) 看到的
// JSON。stdout/stderr 已被 cappedBuffer 截断 (1MB)，安全 marshal。
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

// composeSkillToolName —— 规范化 skill_<skill>_<script-stem> 给 Anthropic。
// Anthropic tool name 必须匹配 ^[a-zA-Z0-9_-]{1,maxToolNameLen}$。任何非法字符
// 替成 `_`，超长截到 maxToolNameLen。
const maxToolNameLen = 64

func composeSkillToolName(skillName, filename string) string {
	stem := strings.TrimSuffix(filename, fileExt(filename))
	raw := skillToolPrefix + skillName + "_" + stem
	clean := skillToolNameRe.ReplaceAllString(raw, "_")
	if len(clean) > maxToolNameLen {
		clean = clean[:maxToolNameLen]
	}
	return clean
}

var skillToolNameRe = regexp.MustCompile(`[^a-zA-Z0-9_-]`)

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

// skillScriptInputSchema —— 把 owner-curated parameters 翻成 Anthropic
// 期望的 JSON-schema (object/properties/required)。无 parameters → 空对象，
// 允许 zero-arg 调用。
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

// scriptSchema —— marshal JSON Schema "object" envelope。
// omitempty 让 required 空时不冒一个 "required":null 出来。
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
