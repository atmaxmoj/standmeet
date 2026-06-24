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

// Card metadata —— summarize_conversation declares this ui:// card on its tool
// `_meta.ui_resource`. The host reads it (resources/read) at assembly and renders
// it sandboxed; the card shows a "report · generated" sneak-peek (the report HTML
// in a nested no-script iframe) + an "open as page" link to /report/<id>.
const (
	reportCardURI  = "ui://summarize/report-card.html"
	reportCardMIME = "text/html"
)

// reportCardHTML —— the self-contained sandboxed report card. Receives the tool
// result {ok, report_id, html} via mcp-ui:data and renders the inline sneak-peek.
// The "open as page" link carries href=/report/<id> (asserted by e2e) AND posts
// mcp-ui:link so the parent actually opens it (the sandbox can't navigate top).
const reportCardHTML = `<!doctype html><html><head><meta charset="utf-8">
<style>
 :root{font-family:ui-serif,Georgia,serif;color:#1B1814}
 body{margin:0;padding:2px}
 .card{border:1px solid #d9d0c2;border-radius:3px;overflow:hidden;background:#F3EFE6}
 header{display:flex;align-items:baseline;justify-content:space-between;gap:10px;
   padding:8px 10px;border-bottom:1px solid #ece5d8}
 .kicker{font:600 11px ui-monospace,monospace;letter-spacing:.1em;
   text-transform:uppercase;color:#8a7c6a}
 a.open{font:12px ui-monospace,monospace;color:#B5391C;text-decoration:none;white-space:nowrap}
 a.open:hover{text-decoration:underline}
 iframe{width:100%;height:280px;border:none;display:block;background:#fff}
</style></head><body>
<script>
(function(){
 function h(){parent.postMessage({type:"mcp-ui:height",
   height:document.documentElement.scrollHeight+8},"*");}
 function esc(s){var d=document.createElement("div");d.textContent=s==null?"":s;return d.innerHTML;}
 function attr(s){return esc(s).replace(/"/g,"&quot;");}
 function render(d){
   var id=d.report_id||"", html=d.html||"", href="/report/"+id;
   document.body.innerHTML='<section class="card" data-testid="tool-card-summarize_conversation"'+
     ' data-report-id="'+attr(id)+'"><header>'+
     '<span class="kicker">report · generated</span>'+
     '<a class="open" data-testid="report-open-link" href="'+attr(href)+'">open as page ↗</a>'+
     '</header><iframe sandbox="" srcdoc="'+attr(html)+'"></iframe></section>';
   document.querySelector("a.open").addEventListener("click",function(e){
     e.preventDefault(); parent.postMessage({type:"mcp-ui:link",href:href},"*");
   });
 }
 window.addEventListener("message",function(e){
   if(e.data&&e.data.type==="mcp-ui:data"){ render(e.data.data||{}); h(); }
 });
 parent.postMessage({type:"mcp-ui:ready"},"*");
})();
</script></body></html>`
