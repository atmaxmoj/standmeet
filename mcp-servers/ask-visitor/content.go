package main

import "encoding/json"

// instructions —— the ask_visitor system-prompt fragment, owned by this server
// (declared via MCP `instructions`, surfaced by the core as the capability's
// SystemPromptFragment). Moved verbatim from the former core prompts file.
const instructions = `You can ask the visitor a structured question when their intent is unclear, rather than guessing. The visitor will see a widget (radio buttons, multi-select, or yes/no) and pick — their selection comes back as the next visitor message.

Tool: **ask_visitor**

Use this when:
- The visitor's question is ambiguous between two or more reasonable interpretations
- You need to pick a path (recruiter vs casual reader, technical depth, time horizon) before answering well
- A short multiple-choice clarifies more than a paragraph of prose would

Args:
- ` + "`question`" + ` (required): the clarifying question, in first person ("Would you like me to focus on…?")
- ` + "`kind`" + ` (required): one of ` + "`radio`" + ` (pick one), ` + "`multi`" + ` (pick any), or ` + "`yes_no`" + ` (auto two options)
- ` + "`options`" + ` (required for radio/multi; ignored for yes_no): 2–6 short option strings
- ` + "`allow_chat`" + ` (optional, default false): show a free-text box too so the visitor can add context

Discipline:
- Don't ask back-to-back — one ask_visitor per turn at most; if the answer is still unclear after one round, just take your best guess and answer
- Keep options short (under ~50 chars each) and mutually distinct
- Don't use this for trivial follow-ups ("would you like more detail?") — that's just continuing the conversation`

// marshalArgs —— re-marshal the parsed tool arguments to a JSON object string,
// which is what the tool echoes (the frontend dispatches by kind).
func marshalArgs(args map[string]any) string {
	b, err := json.Marshal(args)
	if err != nil {
		return "{}"
	}
	return string(b)
}

// cardHTML —— the self-contained sandboxed widget. The core renders this in a
// sandboxed iframe and posts the tool-result data in via
//
//	postMessage({type:'mcp-ui:data', data:{question,kind,options,allow_chat}})
//
// The widget renders radio / multi / yes_no, and on submit posts the visitor's
// choice back out via
//
//	postMessage({type:'mcp-ui:submit', value:'<selection>'})
//
// which the core forwards as the next visitor message.
const cardHTML = `<!doctype html><html><head><meta charset="utf-8">
<style>
 :root{font-family:ui-serif,Georgia,serif;color:#1B1814}
 body{margin:0;padding:12px}
 .q{font:600 14px ui-monospace,monospace;margin:0 0 10px}
 button{display:block;width:100%;text-align:left;margin:4px 0;padding:8px 10px;
   border:1px solid #1B1814;background:#F3EFE6;cursor:pointer;font:14px ui-serif,Georgia,serif}
 button:hover{background:#1B1814;color:#F3EFE6}
 button[aria-pressed=true]{background:#B5391C;color:#fff;border-color:#B5391C}
 .row{display:flex;gap:8px}.row button{width:auto}
 .submit{margin-top:10px;border-color:#B5391C;color:#B5391C;text-align:center}
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
   if(e.data&&e.data.type==="mcp-ui:data"){ render(e.data.data||{}); }
 });
 parent.postMessage({type:"mcp-ui:ready"},"*");
})();
</script></body></html>`
