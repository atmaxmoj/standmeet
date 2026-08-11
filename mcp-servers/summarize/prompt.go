// prompt.go —— the summarize capability's OWN report prompt + transcript→prompt assembly. This is
// capability logic and lives in the sandbox (not the host): the host only runs the LLM on it via the
// generic inference.generate reach-back verb.

package main

import (
	"fmt"
	"strings"
)

// summarizeHTMLPrompt —— system prompt: give the model a FIXED component kit (classes pre-styled by
// the host's report document CSS) to assemble from, not free markup — keeps design consistent + no
// injection. Output a complete HTML body fragment (with <h1>), no <html>/<head>/<body> wrapper.
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

// ownerTurnFallback —— owner 的名字拿不到时给他的标签。**不是 "Assistant"**：
// 这份报告是访客带走给团队看的东西，而 gate 上承诺的是 owner 的声音。
const ownerTurnFallback = "Owner"

// buildSummarizeUserPrompt —— render the transcript into the user turn for the report prompt.
//
// owner 的每一轮**署 owner 的名字**。以前它们被标成 `Assistant:`，开头还写着"对面是 an AI
// assistant" —— 于是模型照着标签写，报告标题成了 "Conversation with AI Assistant"，正文通篇
// "the assistant… its model"（F-A-33）。同一份 prompt 的结构说明其实一直写着这些对话是
// 「对 owner 的面试」、要写成 "The candidate described…"；模型跟的是逐轮标签，不是那句说明。
func buildSummarizeUserPrompt(msgs []chatMessage, ownerName string) string {
	owner := strings.TrimSpace(ownerName)
	if owner == "" {
		owner = ownerTurnFallback
	}
	var b strings.Builder
	_, _ = fmt.Fprintf(&b,
		"Here is a conversation between a visitor and %s, speaking for themselves:\n\n", owner)
	for i := range msgs {
		role := "Visitor"
		if msgs[i].Role == "assistant" {
			role = owner
		}
		_, _ = fmt.Fprintf(&b, "%s: %s\n\n", role, msgs[i].Content)
	}
	_, _ = fmt.Fprintf(&b,
		"\nPlease generate the structured HTML report of this conversation. "+
			"It is a record of what %s said — write about them as a person, never as "+
			"an assistant, a bot, or a model.", owner)
	return b.String()
}
