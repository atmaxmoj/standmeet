// agentskills_summarize_conversation.go —— I.3: summarize_conversation
// capability。LLM 决定调时调一次 inference.Generate 拿 HTML body，落
// chat_reports 表，结果返一段 JSON {ok, report_id, html} 让浏览器渲
// ReportArtifact 卡 (sandbox iframe + 独立 /report/{id} 链接)。
//
// 不 mark conversation ended (跟老 /summary 的语义不同；新 tool 是
// artifact 不是终态)。同 conversation 可多次调，每次新 row。
//
// Shape=ShapeVisitorOnly v1；capability 设计 mode-decoupled，owner-side
// MCP 暴露后续 commit。

package usecases

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/atmaxmoj/standmeet/internal/agentskills"
	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/inference"
	"github.com/atmaxmoj/standmeet/internal/postgres"
	"github.com/atmaxmoj/standmeet/internal/prompts"
)

const (
	capSummarize           = "summarize_conversation"
	capSummarizeFragmentID = "capabilities/summarize_conversation"
	toolSummarizeName      = "summarize_conversation"
)

// summarizeHTMLPrompt —— AI 写 HTML 报告时的 system；要求出完整 body
// 片段 (含 <h1> 标题)，不含 <html>/<head>/<body> 包装。
const summarizeHTMLPrompt = "You generate polished HTML conversation reports. " +
	"Output a complete HTML body fragment (no <html>/<head>/<body> wrapper). " +
	"Required structure:\n\n" +
	"<h1>Title summarizing the conversation</h1>\n" +
	"<h2>Overview</h2><p>2-3 sentence summary.</p>\n" +
	"<h2>Key Topics</h2><ul><li>...</li></ul> (3-5 items)\n" +
	"<h2>Key Takeaways</h2><ul><li>...</li></ul> (3-5 items)\n" +
	"<h2>Next Steps</h2><ul><li>...</li></ul> (optional, only if actionable)\n\n" +
	"Rules:\n" +
	"- No inline styles, no <script>, no <iframe>, no <style> tag\n" +
	"- Use <strong> for emphasis, <a href=...> for links\n" +
	"- Plain HTML semantic tags only (h1/h2/p/ul/li/strong/em/a/blockquote/table)\n" +
	"- Third-person voice (\"The visitor asked about...\")\n" +
	"- ~500 words max; one-page printable"

// SummarizeDeps —— summarize capability 依赖；闭包持。
type SummarizeDeps struct {
	Chats    *postgres.ChatRepo
	Reports  *postgres.ChatReportRepo
	Resolver inference.Resolver
}

// SummarizeCapability —— Capability impl。导出让 NewSummarizeCapability
// 返具体类型 (revive unexported-return)；外部直接持也 OK。
type SummarizeCapability struct {
	deps *SummarizeDeps
}

// NewSummarizeCapability —— DI 构造；wireup 持 registry 调一次。
func NewSummarizeCapability(deps *SummarizeDeps) *SummarizeCapability {
	return &SummarizeCapability{deps: deps}
}

// ID —— Capability ID。
func (*SummarizeCapability) ID() string { return capSummarize }

// Shape —— visitor only v1。
func (*SummarizeCapability) Shape() agentskills.Shape {
	return agentskills.ShapeVisitorOnly
}

// OwnerMCPBindings —— 暂不暴露给 owner MCP；后续 commit 加。
func (*SummarizeCapability) OwnerMCPBindings() []*agentskills.MCPBinding {
	return []*agentskills.MCPBinding{}
}

// SystemPromptFragmentID —— 始终返 fragment id；LLM 就知道 tool 是啥。
func (*SummarizeCapability) SystemPromptFragmentID(
	_ context.Context, _ *agentskills.AssembleInput,
) string {
	return capSummarizeFragmentID
}

// SystemPromptFragment —— 加载 capabilities/summarize_conversation.md。
func (c *SummarizeCapability) SystemPromptFragment(
	ctx context.Context, in *agentskills.AssembleInput,
) string {
	id := c.SystemPromptFragmentID(ctx, in)
	if id == "" {
		return ""
	}
	return prompts.MustLoad(id)
}

// VisitorBinding —— 装一个 summarize_conversation tool。
func (c *SummarizeCapability) VisitorBinding(
	_ context.Context, in *agentskills.AssembleInput,
) (*agentskills.Binding, error) {
	bind := func(ctx context.Context, args string) (string, error) {
		return runSummarize(ctx, c.deps, in, args)
	}
	return &agentskills.Binding{
		Tools: []agentskills.BindingTool{summarizeBindingTool(bind)},
		State: agentskills.CapabilityState{ID: capSummarize, Enabled: true},
	}, nil
}

func summarizeBindingTool(run agentskills.RunFn) agentskills.BindingTool {
	// ReturnDirectly: 报告生成完直接结束 agent loop，把 tool result 推
	// 浏览器渲 ReportArtifactCard；不再走第二轮 LLM (agent 可能误调 corpus
	// 之类的，徒增延迟)。conversation 不终结，visitor 下 turn 可继续。
	return agentskills.NewReturnDirectlyTool(
		toolSummarizeName,
		"Generate a polished HTML report summarizing the conversation so far. "+
			"Returns {report_id, html}. Repeat calls allowed; each generates a "+
			"fresh report row. Does not end the conversation.",
		"writing report",
		json.RawMessage(`{
			"type":"object",
			"properties":{
				"focus":{
					"type":"string",
					"description":"Optional: what angle to emphasize."
				}
			}
		}`),
		run,
	)
}

// summarizeResultWire —— tool_result 推浏览器的 wire；frontend
// ReportArtifact 按 report_id + html 渲卡 + open-as-page 链接。
type summarizeResultWire struct {
	ReportID string `json:"report_id"`
	HTML     string `json:"html"`
	OK       bool   `json:"ok"`
}

func runSummarize(
	ctx context.Context, deps *SummarizeDeps, in *agentskills.AssembleInput, _ string,
) (string, error) {
	html, err := generateReportHTML(ctx, deps, in)
	if err != nil {
		return marshalSummarizeFail(err), nil
	}
	row, perr := deps.Reports.Create(ctx, &postgres.CreateReportInput{
		OwnerID: in.OwnerID, ConversationID: in.ConversationID, HTML: html,
	})
	if perr != nil {
		return marshalSummarizeFail(perr), nil
	}
	return marshalSummarizeOK(row.ID, html), nil
}

func generateReportHTML(
	ctx context.Context, deps *SummarizeDeps, in *agentskills.AssembleInput,
) (string, error) {
	transcript, terr := loadTranscriptForSummarize(ctx, deps, in)
	if terr != nil {
		return "", terr
	}
	cred, cerr := deps.Resolver.Resolve(ctx, &inference.ResolveInput{
		OwnerID: in.OwnerID, Mode: in.Mode,
	})
	if cerr != nil {
		return "", fmt.Errorf("resolve cred: %w", cerr)
	}
	out, gerr := inference.Generate(ctx, cred, &inference.ChatRequest{
		System: summarizeHTMLPrompt,
		Messages: []inference.ChatRequestMsg{
			{Role: "user", Content: buildSummarizeUserPrompt(transcript)},
		},
	})
	if gerr != nil {
		return "", fmt.Errorf("generate report: %w", gerr)
	}
	return out, nil
}

func loadTranscriptForSummarize(
	ctx context.Context, deps *SummarizeDeps, in *agentskills.AssembleInput,
) ([]domain.Message, error) {
	bundle, err := deps.Chats.GetWithMessages(ctx, in.OwnerID, in.ConversationID)
	if err != nil {
		return nil, fmt.Errorf("load conversation: %w", err)
	}
	return bundle.Messages, nil
}

func buildSummarizeUserPrompt(msgs []domain.Message) string {
	var b strings.Builder
	_, _ = b.WriteString("Here is a conversation between a visitor and an AI assistant:\n\n")
	for i := range msgs {
		role := "Visitor"
		if msgs[i].Role == "assistant" {
			role = "Assistant"
		}
		_, _ = fmt.Fprintf(&b, "%s: %s\n\n", role, msgs[i].Body)
	}
	_, _ = b.WriteString("\nPlease generate the structured HTML report of this conversation.")
	return b.String()
}

func marshalSummarizeOK(reportID, html string) string {
	buf, err := json.Marshal(summarizeResultWire{
		OK: true, ReportID: reportID, HTML: html,
	})
	if err != nil {
		return `{"ok":false,"error":"marshal_failed"}`
	}
	return string(buf)
}

func marshalSummarizeFail(err error) string {
	return fmt.Sprintf(`{"ok":false,"error":%q}`, err.Error())
}
