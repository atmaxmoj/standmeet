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

// askVisitorTool —— faithful eval of ask_visitor (a ReturnDirectly tool): the
// agent asks the visitor a structured clarifying question when intent is
// ambiguous; the tool just echoes the question metadata (the visitor's choice
// would come back as the next user message). ReturnDirectly => the loop ends
// with this, no extra LLM turn.
type askVisitorTool struct{}

func (t *askVisitorTool) Info(_ context.Context) (*schema.ToolInfo, error) {
	return &schema.ToolInfo{
		Name: "ask_visitor",
		Desc: "Ask the visitor a structured clarifying question when their intent is ambiguous. " +
			"Returns the question metadata; the visitor's choice comes back as the next user message.",
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"question": {Type: schema.String, Desc: "the clarifying question, first-person", Required: true},
			"kind":     {Type: schema.String, Desc: "widget: radio | multi | yes_no", Required: false},
		}),
	}, nil
}

func (t *askVisitorTool) InvokableRun(_ context.Context, argsJSON string, _ ...tool.Option) (string, error) {
	if argsJSON == "" {
		argsJSON = "{}"
	}
	out, err := json.Marshal(map[string]any{"ok": true, "asked": json.RawMessage(argsJSON)})
	if err != nil {
		return "", fmt.Errorf("ask_visitor marshal: %w", err)
	}
	return string(out), nil
}

// listSlotsTool —— canned eval of list_slots (prod hits Google Calendar + DB;
// the eval is DB-free, so it returns fixed illustrative slots). Lets the agent's
// USE of the booking flow be tested even though the data is canned.
type listSlotsTool struct{}

func (t *listSlotsTool) Info(_ context.Context) (*schema.ToolInfo, error) {
	return &schema.ToolInfo{
		Name: "list_slots",
		Desc: "List available [start, end] meeting slots on the owner's calendar within a window.",
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"from_rfc3339":  {Type: schema.String, Desc: "search window start (RFC3339)", Required: false},
			"until_rfc3339": {Type: schema.String, Desc: "search window end (RFC3339)", Required: false},
			"duration_min":  {Type: schema.Integer, Desc: "slot length in minutes", Required: false},
		}),
	}, nil
}

func (t *listSlotsTool) InvokableRun(_ context.Context, _ string, _ ...tool.Option) (string, error) {
	slots := []map[string]string{
		{"start": "2026-06-09T15:00:00Z", "end": "2026-06-09T15:30:00Z"},
		{"start": "2026-06-09T16:30:00Z", "end": "2026-06-09T17:00:00Z"},
		{"start": "2026-06-10T14:00:00Z", "end": "2026-06-10T14:30:00Z"},
	}
	out, err := json.Marshal(map[string]any{"ok": true, "slots": slots})
	if err != nil {
		return "", fmt.Errorf("list_slots marshal: %w", err)
	}
	return string(out), nil
}

// calendarBookTool —— canned eval of calendar_book (prod writes Google Calendar
// + a code_bookings row; the eval is DB-free, so it returns a fixed confirmation).
type calendarBookTool struct{}

func (t *calendarBookTool) Info(_ context.Context) (*schema.ToolInfo, error) {
	return &schema.ToolInfo{
		Name: "calendar_book",
		Desc: "Book a meeting on the owner's calendar once the visitor has picked a slot and given a topic + email.",
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"topic":         {Type: schema.String, Desc: "meeting topic", Required: true},
			"visitor_email": {Type: schema.String, Desc: "visitor email", Required: true},
			"duration_min":  {Type: schema.Integer, Desc: "duration in minutes", Required: false},
		}),
	}, nil
}

func (t *calendarBookTool) InvokableRun(_ context.Context, _ string, _ ...tool.Option) (string, error) {
	out, err := json.Marshal(map[string]any{
		"ok": true, "event_id": "evt_eval_canned", "status": "confirmed",
	})
	if err != nil {
		return "", fmt.Errorf("calendar_book marshal: %w", err)
	}
	return string(out), nil
}

// personaToolset —— the full visitor toolset for an eval turn: real corpus
// retrieval (ACL-respecting) + every built-in tool, mirroring prod's 7-tool
// visitor agent. Returns the eino tools, progress labels, and the ReturnDirectly
// name set (ask_visitor ends the turn directly). convo backs summarize.
func personaToolset(
	c *corpus, cred agentcore.Cred, convo []convTurn,
) ([]tool.BaseTool, map[string]string, map[string]bool) {
	tools, labels := corpusToolset(c)
	tools = append(tools,
		&summarizeTool{cred: cred, convo: convo},
		&askVisitorTool{},
		&listSlotsTool{},
		&calendarBookTool{},
	)
	labels["summarize_conversation"] = "writing a report"
	labels["ask_visitor"] = "asking a question"
	labels["list_slots"] = "checking the calendar"
	labels["calendar_book"] = "booking the meeting"
	returnDirectly := map[string]bool{"ask_visitor": true}
	return tools, labels, returnDirectly
}
