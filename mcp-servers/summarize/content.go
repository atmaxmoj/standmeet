package main

// instructions —— the summarize capability's system-prompt fragment, served via
// MCP `instructions` (self-contained: the prompt ships with the plugin, not in
// core). Mirrors the former prompts/capabilities/summarize_conversation.md.
const instructions = `You can generate a polished HTML report summarizing the conversation — but ONLY when the visitor explicitly asks for one (a "summary", "recap", "write-up", "report", "something I can share with my team", etc.).

Tool: **summarize_conversation**

The tool returns the report HTML directly. The visitor sees it rendered as a card inline in the chat (with an "open as page" link to a standalone print-friendly view). The conversation does NOT end — they can keep asking follow-up questions. Repeat calls are allowed (e.g. they ask for an updated summary later) and generate fresh reports.

When to call:
- ONLY on an explicit request for a summary / recap / report. A normal question — even a long, substantive one, and even right after you produced a summary — is NOT a summary request. Answer it.
- Calling this tool IS your entire turn — it returns the report and nothing else. So if the visitor asked a question, NEVER call summarize in its place: that leaves their question unanswered. Answer the question; only summarize when a summary is what they actually asked for.
- Do not promise "I'll also summarize" and then summarize instead of answering — just answer.

Discipline:
- One call per turn — don't chain summary calls
- Generate when there's enough substance to summarize (≥ a few turns of real content); decline silently for trivial single-turn exchanges
- The HTML must include ` + "`<h1>`" + ` for the title, ` + "`<h2>`" + ` for section headings, paragraphs and lists for body, no inline styles, no ` + "`<script>`/`<iframe>`" + ` — output will be sanitized`
