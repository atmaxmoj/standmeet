package main

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/cloudwego/eino/components/tool"
	"github.com/cloudwego/eino/schema"

	"github.com/atmaxmoj/standmeet/agentcore"
)

// builtin_tools.go —— faithful eval fixtures of the visitor agent's built-in
// tools beyond corpus retrieval, so the eval reflects the FULL prod toolset
// (corpus_search/read/list, summarize_conversation, ask_visitor, calendar_book,
// list_slots), not just corpus. LLM-driven tools reuse the REAL prod prompt;
// DB-coupled tools use canned fixtures (the eval is a standalone stack — no DB).

// summarizeHTMLPrompt —— mirrors the prod summarize_conversation capability
// prompt verbatim (backend internal/usecases/agentskills_summarize_conversation.go)
// so the eval exercises the real report prompt, not a re-write. Keep in sync.
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

// summarizeTool —— faithful eval of summarize_conversation: the agent calls it,
// we run the REAL report prompt over the interview so far on the real LLM (via
// the facade), and return the {ok, html} envelope the agent sees. We skip the
// chat_reports DB persist + report_id (eval has no DB); the LLM-quality part —
// does the agent call it at the right time, and is the HTML report any good —
// is exactly what's preserved.
type summarizeTool struct {
	cred  agentcore.Cred
	convo []convTurn
}

func (t *summarizeTool) Info(_ context.Context) (*schema.ToolInfo, error) {
	return &schema.ToolInfo{
		Name: "summarize_conversation",
		Desc: "Generate a polished HTML report summarizing this conversation. " +
			"Call this when the visitor asks for a summary, recap, write-up, or report of the chat.",
	}, nil
}

func (t *summarizeTool) InvokableRun(ctx context.Context, _ string, _ ...tool.Option) (string, error) {
	msgs := make([]agentcore.ChatRequestMsg, 0, len(t.convo))
	for _, c := range t.convo {
		role := "user"
		if c.Role == "candidate" {
			role = "assistant"
		}
		msgs = append(msgs, agentcore.ChatRequestMsg{Role: role, Content: c.Text})
	}
	html, err := agentcore.Generate(ctx, &t.cred, summarizeHTMLPrompt, msgs)
	if err != nil {
		return "", fmt.Errorf("summarize_conversation generate: %w", err)
	}
	out, merr := json.Marshal(map[string]any{"ok": true, "html": html})
	if merr != nil {
		return "", fmt.Errorf("summarize_conversation marshal: %w", merr)
	}
	return string(out), nil
}

// personaToolset —— the full visitor toolset for an eval turn: real corpus
// retrieval (ACL-respecting) + the built-in tools. convo is the interview so
// far, used by summarize_conversation.
func personaToolset(c *corpus, cred agentcore.Cred, convo []convTurn) ([]tool.BaseTool, map[string]string) {
	tools, labels := corpusToolset(c)
	tools = append(tools, &summarizeTool{cred: cred, convo: convo})
	labels["summarize_conversation"] = "writing a report"
	return tools, labels
}
