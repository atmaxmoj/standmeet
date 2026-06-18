// capreg_summarize_conversation.go —— I.3: summarize_conversation
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

	"github.com/atmaxmoj/standmeet/internal/capreg"
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

// summarizeHTMLPrompt —— AI 写 HTML 报告时的 system。给一套**固定组件 kit**
// (预先在 report-document.ts / reportPrintCSS 里 styled 好的 class) 让 AI
// 组装,而不是从零写 markup + 样式。禁止自创 style/class,保证设计一致 + 无注入。
// 出完整 body 片段 (含 <h1>),不含 <html>/<head>/<body> 包装。
const summarizeHTMLPrompt = "You generate a polished HTML conversation report. " +
	"Compose it ONLY from the StandMeet report component kit below — do not invent " +
	"your own classes, inline styles, <style>, or <script>; the page already styles " +
	"these. Output a complete HTML body fragment (no <html>/<head>/<body> wrapper).\n\n" +
	"Component kit:\n" +
	"- <h1>…</h1> — the report title (exactly one).\n" +
	"- <p class=\"lede\">…</p> — opening 2-3 sentence overview.\n" +
	"- <h2>…</h2> — section heading (e.g. Key Topics / Key Takeaways / Next Steps).\n" +
	"- <div class=\"callout\">…</div> — box highlighting one standout insight.\n" +
	"- <ul class=\"checks\"><li>…</li></ul> — takeaways / next steps lists.\n" +
	"- <div class=\"tags\"><span class=\"tag\">topic</span>…</div> — topic chips.\n" +
	"- STAR block — the structured spine for one experience:\n" +
	"    <div class=\"exp\"><h2>Experience name</h2><div class=\"star\">\n" +
	"      <div class=\"star-row\"><span class=\"star-k\">Situation</span>" +
	"<div class=\"star-v\">…</div></div>\n" +
	"      <div class=\"star-row\"><span class=\"star-k\">Task</span>" +
	"<div class=\"star-v\">…</div></div>\n" +
	"      (then Action, then Result, same shape)\n" +
	"    </div></div>\n" +
	"- plain <p>, <ul>/<li>, <strong>, <em>, <a href>, <blockquote> are fine too.\n\n" +
	"Structure — most of these conversations are interviews / evaluations of the " +
	"owner, and the reader is a recruiter or hiring manager, so DEFAULT TO STAR:\n" +
	"- <h1> title, then a <p class=\"lede\"> 2-3 sentence overall read.\n" +
	"- For EACH substantive experience discussed (a project, an incident), one " +
	"<div class=\"exp\"> STAR block (Situation / Task / Action / Result). This is " +
	"the spine of the report — use the star component, never loose bullets for it.\n" +
	"- Close with <h2>Assessment</h2> + <ul class=\"checks\"> of honest strengths " +
	"and gaps the conversation revealed.\n" +
	"Use judgment: if the conversation clearly is NOT about evaluating someone's " +
	"experience (e.g. a casual Q&A), skip STAR and write a plain topical summary " +
	"(overview + key topics + takeaways) instead.\n" +
	"Rules:\n" +
	"- Third-person voice (\"The candidate described...\")\n" +
	"- Ground every Result in what was actually said; do not invent outcomes/metrics\n" +
	"- ~500 words max; one-page printable; no images"

// SummarizeDeps —— summarize capability 依赖；闭包持。
type SummarizeDeps struct {
	Chats    ConversationGetter
	Reports  ReportStore
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
func (*SummarizeCapability) Shape() capreg.Shape {
	return capreg.ShapeVisitorOnly
}

// OwnerMCPBindings —— 暂不暴露给 owner MCP；后续 commit 加。
func (*SummarizeCapability) OwnerMCPBindings() []*capreg.MCPBinding {
	return []*capreg.MCPBinding{}
}

// SystemPromptFragmentID —— 始终返 fragment id；LLM 就知道 tool 是啥。
func (*SummarizeCapability) SystemPromptFragmentID(
	_ context.Context, _ *capreg.AssembleInput,
) string {
	return capSummarizeFragmentID
}

// SystemPromptFragment —— 加载 capabilities/summarize_conversation.md。
func (c *SummarizeCapability) SystemPromptFragment(
	ctx context.Context, in *capreg.AssembleInput,
) string {
	id := c.SystemPromptFragmentID(ctx, in)
	if id == "" {
		return ""
	}
	return prompts.MustLoad(id)
}

// VisitorBinding —— 装一个 summarize_conversation tool。
func (c *SummarizeCapability) VisitorBinding(
	_ context.Context, in *capreg.AssembleInput,
) (*capreg.Binding, error) {
	bind := func(ctx context.Context, args string) (string, error) {
		return runSummarize(ctx, c.deps, in, args)
	}
	return &capreg.Binding{
		Tools: []capreg.BindingTool{summarizeBindingTool(bind)},
		State: capreg.CapabilityState{ID: capSummarize, Enabled: true},
	}, nil
}

func summarizeBindingTool(run capreg.RunFn) capreg.BindingTool {
	// ReturnDirectly: 报告生成完直接结束 agent loop，把 tool result 推
	// 浏览器渲 ReportArtifactCard；不再走第二轮 LLM (agent 可能误调 corpus
	// 之类的，徒增延迟)。conversation 不终结，visitor 下 turn 可继续。
	return capreg.NewReturnDirectlyTool(
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
	ctx context.Context, deps *SummarizeDeps, in *capreg.AssembleInput, _ string,
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
	ctx context.Context, deps *SummarizeDeps, in *capreg.AssembleInput,
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
	ctx context.Context, deps *SummarizeDeps, in *capreg.AssembleInput,
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
