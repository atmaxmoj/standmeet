// capreg_summarize_conversation.go —— summarize 的 HOST 侧 report pipeline。
//
// 归一(#144)后 summarize 的 MCP **能力**已外置成沙箱插件(mcp-servers/summarize)；
// 主 app 内不再有它的 capability/tool 代码。这里只留**生成报告的 compute pipeline**
// (transcript → inference.Generate → HTML)——它是后端的算力/数据 plumbing，由
// capreg_summarize_socket.go 的窄 socket op 调用，插件经 socket 够到它。

package usecases

import (
	"context"
	"fmt"
	"strings"

	"github.com/atmaxmoj/standmeet/internal/capreg"
	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/inference"
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

// SummarizeDeps —— report pipeline 的窄依赖；socket handler 持。
type SummarizeDeps struct {
	Chats    ConversationGetter
	Reports  ReportStore
	Resolver inference.Resolver
}

// generateReportHTML —— transcript → resolve cred → inference.Generate → HTML body。
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
