// ask-visitor-mcp.js — the ask_visitor block as a stdio-MCP server, in JS (cross-platform, no Go).
//
// Replaces the former Go binary (mcp-servers/ask-visitor) verbatim in behaviour: one tool that echoes
// the LLM's structured question back as a JSON object string (the frontend dispatches by kind), a
// system-prompt fragment via MCP `instructions`, the tool's `_meta` (return_directly + ui_resource),
// and the ui:// card resource. It owns no host data and reaches nothing back — network-isolated.
// Being JS, it cannot import any host/Go internals: host-blindness is structural, not guard-enforced.

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js')
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js')
const { z } = require('zod')

const uiCardURI = 'ui://ask-visitor/card.html'
const uiCardMIME = 'text/html'

// instructions — the ask_visitor system-prompt fragment (surfaced by the host as the block's
// SystemPromptFragment). Ported verbatim from the Go block's content.go.
const instructions = `You can ask the visitor a structured question when their intent is unclear, rather than guessing. The visitor will see a widget (radio buttons, multi-select, or yes/no) and pick — their selection comes back as the next visitor message.

Tool: **ask_visitor**

Use this when:
- The visitor's question is ambiguous between two or more reasonable interpretations
- You need to pick a path (recruiter vs casual reader, technical depth, time horizon) before answering well
- A short multiple-choice clarifies more than a paragraph of prose would

Args:
- \`question\` (required): the clarifying question, in first person ("Would you like me to focus on…?")
- \`kind\` (required): one of \`radio\` (pick one), \`multi\` (pick any), or \`yes_no\` (auto two options)
- \`options\` (required for radio/multi; ignored for yes_no): 2–6 short option strings
- \`allow_chat\` (optional, default false): show a free-text box too so the visitor can add context

Discipline:
- Don't ask back-to-back — one ask_visitor per turn at most; if the answer is still unclear after one round, just take your best guess and answer
- Keep options short (under ~50 chars each) and mutually distinct
- Don't use this for trivial follow-ups ("would you like more detail?") — that's just continuing the conversation`

// cardHTML — the self-contained sandboxed widget, rendered by the host in a sandboxed iframe. Ported
// verbatim from content.go. Receives {question,kind,options,allow_chat} via postMessage mcp-ui:data,
// posts the visitor's choice back via mcp-ui:submit.
const cardHTML = `<!doctype html><html><head><meta charset="utf-8">
<style>
 :root{--ink:#1B1814;--paper:#F3EFE6;--accent:#B5391C;
   font-family:ui-serif,Georgia,serif;color:var(--ink)}
 body{margin:0;padding:12px}
 .q{font:600 14px ui-monospace,monospace;margin:0 0 10px}
 button{display:block;width:100%;text-align:left;margin:4px 0;padding:8px 10px;color:var(--ink);
   border:1px solid var(--ink);background:var(--paper);cursor:pointer;font:14px ui-serif,Georgia,serif}
 button:hover{background:var(--ink);color:var(--paper)}
 button[aria-pressed=true]{background:var(--accent);color:#fff;border-color:var(--accent)}
 .row{display:flex;gap:8px}.row button{width:auto}
 .submit{margin-top:10px;border-color:var(--accent);color:var(--accent);text-align:center}
 textarea{width:100%;box-sizing:border-box;margin-top:8px;font:14px ui-serif,Georgia,serif}
 [data-answered=true]{opacity:.55;pointer-events:none}
</style></head><body data-testid="ask-visitor-card">
<div id="q" class="q" data-testid="ask-visitor-question"></div>
<div id="opts"></div>
<script>
(function(){
 var picks={}, kind="", answered=false;
 function send(v){ if(answered)return; answered=true;
   document.body.setAttribute("data-answered","true");
   parent.postMessage({type:"mcp-ui:submit",value:v},"*"); }
 // theme —— the host page's design tokens (ink/paper/accent…), so the card matches a dark page;
 // missing tokens keep the built-in light palette.
 function theme(t){ if(!t||typeof t!=="object")return;
   Object.keys(t).forEach(function(k){
     if(typeof t[k]==="string")document.documentElement.style.setProperty("--"+k,t[k]); }); }
 function postHeight(){ parent.postMessage(
   {type:"mcp-ui:height",height:Math.ceil(document.body.getBoundingClientRect().height)+8},"*"); }
 function render(d){
   kind=d.kind||"radio";
   document.body.setAttribute("data-kind",kind);
   document.getElementById("q").textContent=d.question||"";
   var host=document.getElementById("opts"); host.innerHTML="";
   if(kind==="yes_no"){
     var r=document.createElement("div"); r.className="row";
     [["yes","Yes"],["no","No"]].forEach(function(o){
       var b=document.createElement("button");
       b.textContent=o[1]; b.setAttribute("data-testid","ask-visitor-opt-"+o[0]);
       b.onclick=function(){send(o[1]);}; r.appendChild(b);
     }); host.appendChild(r); return;
   }
   var opts=d.options||[];
   opts.forEach(function(o,i){
     var b=document.createElement("button");
     b.textContent=o; b.setAttribute("data-testid","ask-visitor-opt-"+i);
     if(kind==="multi"){
       b.setAttribute("aria-pressed","false");
       b.onclick=function(){ picks[i]=!picks[i];
         b.setAttribute("aria-pressed",picks[i]?"true":"false"); };
     } else { b.onclick=function(){send(o);}; }
     host.appendChild(b);
   });
   if(kind==="multi"){
     var s=document.createElement("button"); s.className="submit";
     s.textContent="Submit"; s.setAttribute("data-testid","ask-visitor-submit");
     s.onclick=function(){ var chosen=opts.filter(function(_,i){return picks[i];});
       send(chosen.join(", ")); }; host.appendChild(s);
   }
 }
 window.addEventListener("message",function(e){
   if(e.data&&e.data.type==="mcp-ui:data"){ theme(e.data.theme); render(e.data.data||{}); postHeight(); }
 });
 parent.postMessage({type:"mcp-ui:ready"},"*");
})();
</script></body></html>`

async function main() {
  const server = new McpServer(
    { name: 'ask-visitor', version: '1.0.0' },
    { instructions, capabilities: { tools: {}, resources: {} } },
  )

  server.registerTool(
    'ask_visitor',
    {
      description:
        'Ask the visitor a structured clarifying question when their intent is ambiguous. ' +
        "Returns the question metadata; the visitor's choice comes back as the next user message.",
      inputSchema: {
        question: z.string().describe('The clarifying question, first-person.'),
        kind: z.string().describe('radio | multi | yes_no'),
        options: z.array(z.string()).optional().describe('2-6 short options for radio/multi; ignored for yes_no.'),
        allow_chat: z.boolean().optional().describe('If true, show a free-text box alongside the widget.'),
      },
      // MCP Apps: declare this tool's ui:// card + return-directly on the tool `_meta`. The host reads
      // the card (resources/read) at assembly and renders it sandboxed for this tool.
      _meta: { return_directly: true, ui_resource: uiCardURI },
    },
    // Echo the LLM's args back as a JSON object string; the frontend dispatches by kind. No host, no LLM.
    async (args) => ({ content: [{ type: 'text', text: JSON.stringify(args) }] }),
  )

  server.registerResource(
    'ask_visitor card',
    uiCardURI,
    { mimeType: uiCardMIME, description: 'Sandboxed ask_visitor widget (radio/multi/yes_no).' },
    async () => ({ contents: [{ uri: uiCardURI, mimeType: uiCardMIME, text: cardHTML }] }),
  )

  await server.connect(new StdioServerTransport())
}

main().catch((e) => {
  console.error(e) // stderr only — stdout is the JSON-RPC channel
  process.exit(1)
})
