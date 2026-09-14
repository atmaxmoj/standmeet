// summarize-mcp.js — the summarize_conversation block as a stdio-MCP server, in JS (cross-platform).
//
// Replaces mcp-servers/summarize (Go) verbatim. The report-generation orchestration lives HERE (the
// STAR prompt + transcript→prompt assembly are block logic), reaching back only for core resources
// via fixed-vocabulary verbs: conversation.read → inference.generate (owner LLM) → report.store (host
// sanitizes + styled-renders + persists). Owns no data; reads the trusted session off the tool `_meta`.

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js')
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js')
const { z } = require('zod')
const { gwCall, sessionFromMeta } = require('./gateway.js')

const reportCardURI = 'ui://summarize/report-card.html'
const reportCardMIME = 'text/html'
const ownerTurnFallback = 'Owner'

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
- The HTML must include \`<h1>\` for the title, \`<h2>\` for section headings, paragraphs and lists for body, no inline styles, no \`<script>\`/\`<iframe>\` — output will be sanitized`

// summarizeHTMLPrompt — system prompt giving the model a FIXED component kit (host-styled classes) to
// assemble from, not free markup. Ported verbatim from prompt.go.
const summarizeHTMLPrompt =
  'You generate a polished HTML conversation report. ' +
  'Compose it ONLY from the StandMeet report component kit below — do not invent ' +
  'your own classes, inline styles, <style>, or <script>; the page already styles ' +
  'these. Output a complete HTML body fragment (no <html>/<head>/<body> wrapper).\n\n' +
  'Component kit:\n' +
  '- <h1>…</h1> — the report title (exactly one).\n' +
  '- <p class="lede">…</p> — opening 2-3 sentence overview.\n' +
  '- <h2>…</h2> — section heading (e.g. Key Topics / Key Takeaways / Next Steps).\n' +
  '- <div class="callout">…</div> — box highlighting one standout insight.\n' +
  '- <ul class="checks"><li>…</li></ul> — takeaways / next steps lists.\n' +
  '- <div class="tags"><span class="tag">topic</span>…</div> — topic chips.\n' +
  '- STAR block — the structured spine for one experience:\n' +
  '    <div class="exp"><h2>Experience name</h2><div class="star">\n' +
  '      <div class="star-row"><span class="star-k">Situation</span>' +
  '<div class="star-v">…</div></div>\n' +
  '      <div class="star-row"><span class="star-k">Task</span>' +
  '<div class="star-v">…</div></div>\n' +
  '      (then Action, then Result, same shape)\n' +
  '    </div></div>\n' +
  '- plain <p>, <ul>/<li>, <strong>, <em>, <a href>, <blockquote> are fine too.\n\n' +
  'Structure — most of these conversations are interviews / evaluations of the ' +
  'owner, and the reader is a recruiter or hiring manager, so DEFAULT TO STAR:\n' +
  '- <h1> title, then a <p class="lede"> 2-3 sentence overall read.\n' +
  '- For EACH substantive experience discussed (a project, an incident), one ' +
  '<div class="exp"> STAR block (Situation / Task / Action / Result). This is ' +
  'the spine of the report — use the star component, never loose bullets for it.\n' +
  '- Close with <h2>Assessment</h2> + <ul class="checks"> of honest strengths ' +
  'and gaps the conversation revealed.\n' +
  'Use judgment: if the conversation clearly is NOT about evaluating someone\'s ' +
  'experience (e.g. a casual Q&A), skip STAR and write a plain topical summary ' +
  '(overview + key topics + takeaways) instead.\n' +
  'Rules:\n' +
  '- Third-person voice ("The candidate described...")\n' +
  '- Ground every Result in what was actually said; do not invent outcomes/metrics\n' +
  '- ~500 words max; one-page printable; no images'

// reportCardHTML — the self-contained sandboxed report card (sneak-peek + open-as-page). Ported
// verbatim from content.go.
const reportCardHTML = `<!doctype html><html><head><meta charset="utf-8">
<style>
 :root{font-family:ui-serif,Georgia,serif;color:#1B1814}
 body{margin:0;padding:2px}
 .card{border:1px solid #d9d0c2;border-radius:3px;overflow:hidden;background:#F3EFE6;position:relative}
 .card::after{content:"";position:absolute;left:1px;right:1px;bottom:1px;height:56px;
   background:linear-gradient(to bottom,rgba(255,255,255,0),#fff);pointer-events:none}
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

// ── summarize-specific reach-back verbs (built on the shared gwCall) ──

async function gwConversationRead(ownerID, conversationID) {
  const raw = await gwCall('conversation.read', { owner_id: ownerID, conversation_id: conversationID })
  const r = JSON.parse(raw)
  return Array.isArray(r.messages) ? r.messages : []
}

async function gwOwnerFullName(ownerID) {
  // Missing name is not a failure: the report just uses a neutral third-person label.
  try {
    const raw = await gwCall('owner.meta', { owner_id: ownerID, field: 'full_name' })
    const r = JSON.parse(raw)
    return typeof r.value === 'string' ? r.value : ''
  } catch {
    return ''
  }
}

async function gwInferenceGenerate(ownerID, mode, system, messages) {
  const raw = await gwCall('inference.generate', { owner_id: ownerID, mode, system, messages })
  const r = JSON.parse(raw)
  return typeof r.output === 'string' ? r.output : ''
}

async function gwReportStore(ownerID, conversationID, html) {
  const raw = await gwCall('report.store', { owner_id: ownerID, conversation_id: conversationID, html })
  const r = JSON.parse(raw)
  return { reportID: r.report_id || '', styled: r.html || '' }
}

// buildSummarizeUserPrompt — render the transcript into the user turn; owner turns are signed with the
// owner's name (never "Assistant"). Ported verbatim from prompt.go.
function buildSummarizeUserPrompt(msgs, ownerName) {
  const owner = (ownerName || '').trim() || ownerTurnFallback
  let b = `Here is a conversation between a visitor and ${owner}, speaking for themselves:\n\n`
  for (const m of msgs) {
    const role = m.role === 'assistant' ? owner : 'Visitor'
    b += `${role}: ${m.content}\n\n`
  }
  b += `\nPlease generate the structured HTML report of this conversation. ` +
    `It is a record of what ${owner} said — write about them as a person, never as ` +
    `an assistant, a bot, or a model.`
  return b
}

// runSummarize — conversation.read → build STAR prompt → inference.generate → report.store.
async function runSummarize(s) {
  const msgs = await gwConversationRead(s.ownerID, s.conversationID)
  const ownerName = await gwOwnerFullName(s.ownerID)
  const raw = await gwInferenceGenerate(s.ownerID, s.mode, summarizeHTMLPrompt, [
    { role: 'user', content: buildSummarizeUserPrompt(msgs, ownerName) },
  ])
  const { reportID, styled } = await gwReportStore(s.ownerID, s.conversationID, raw)
  return JSON.stringify({ report_id: reportID, html: styled, ok: true })
}

async function main() {
  const server = new McpServer(
    { name: 'summarize', version: '1.0.0' },
    { instructions, capabilities: { tools: {}, resources: {} } },
  )

  server.registerTool(
    'summarize_conversation',
    {
      description:
        'Generate a polished HTML report summarizing the conversation. Call ONLY when the visitor ' +
        'explicitly asks for a summary / recap / report. It ends the turn and returns the report, ' +
        'rendered as a card.',
      inputSchema: { focus: z.string().optional().describe('Optional: what angle to emphasize.') },
      // return_directly + ui card; long_running because host-side LLM generation exceeds the generic
      // 15s CallTool cap (F-A-6) — the host grants LongCallTimeout.
      _meta: { return_directly: true, ui_resource: reportCardURI, long_running: true },
    },
    async (_args, extra) => {
      const sess = sessionFromMeta(extra)
      // session also carries conversation_id + mode (beyond owner_id/visitor_email).
      const s = {
        ownerID: sess.ownerID,
        conversationID: (extra && extra._meta && extra._meta['standmeet/session'] || {}).conversation_id || '',
        mode: (extra && extra._meta && extra._meta['standmeet/session'] || {}).mode || '',
      }
      try {
        return { content: [{ type: 'text', text: await runSummarize(s) }] }
      } catch (e) {
        return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: e.message }) }] }
      }
    },
  )

  server.registerResource(
    'report card',
    reportCardURI,
    { mimeType: reportCardMIME, description: 'Sandboxed summarize_conversation report sneak-peek.' },
    async () => ({ contents: [{ uri: reportCardURI, mimeType: reportCardMIME, text: reportCardHTML }] }),
  )

  await server.connect(new StdioServerTransport())
}

main().catch((e) => {
  console.error(e) // stderr only — stdout is the JSON-RPC channel
  process.exit(1)
})
