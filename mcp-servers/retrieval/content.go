package main

// instructions —— the retrieval capability's system-prompt fragment, served via MCP
// `instructions` (self-contained: the prompt ships with the plugin, not in core).
// Mirrors the former prompts/capabilities/corpus.retrieval.md verbatim so the
// composed system prompt (and its hash) is unchanged for a retrieval session.
const instructions = `You have three tools for accessing the owner's curated corpus:
  • corpus_search(query) — find entries matching a keyword;
  • corpus_read(path)    — fetch the full body of one entry;
  • corpus_list(prefix?) — browse entries by path prefix.

When the visitor's question relates to the owner's work / projects / opinions, search first, read the most relevant entries, then answer. Quote output entries verbatim when they fit; paraphrase wiki entries.`

// Card metadata —— corpus_search / corpus_list both declare this one ui:// card on
// their tool `_meta.ui_resource`. The host reads it (resources/read) at assembly and
// renders it sandboxed; the card picks "searched" vs "browsed" off the `tool` name
// the host plants in mcp-ui:data, so one card serves both. corpus_read ships NO card
// (its result flows to the Citation strip, not a tool card).
const (
	searchCardURI  = "ui://retrieval/search-card.html"
	searchCardMIME = "text/html"
)

// searchCardHTML —— the self-contained sandboxed corpus-hits card. Receives the tool
// result (an array of {path,title,genre,summary?}) via
//
//	postMessage({type:'mcp-ui:data', data:[...], tool:'corpus_search'|'corpus_list'})
//
// and renders a collapsed <details> ("searched/browsed · N entries") that expands to
// the hit list. Read-only — no submit/link; pure display (replaces SearchHitsCard).
const searchCardHTML = `<!doctype html><html><head><meta charset="utf-8">
<style>
 :root{font-family:ui-serif,Georgia,serif;color:#1B1814}
 body{margin:0;padding:4px 2px}
 details{font:13px ui-serif,Georgia,serif}
 summary{font:600 12px ui-monospace,monospace;cursor:pointer;list-style:none;
   color:#6b5d4f;padding:2px 0;user-select:none}
 summary::-webkit-details-marker{display:none}
 summary:hover{color:#B5391C}
 ul{list-style:none;margin:6px 0 0;padding:0;border-top:1px solid #d9d0c2}
 li{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px;padding:6px 0;
   border-bottom:1px solid #ece5d8}
 .genre{font:11px ui-monospace,monospace;color:#8a7c6a;text-transform:uppercase}
 .genre.out{color:#B5391C}
 .title{font-weight:600}
 .summary{flex-basis:100%;font-size:12px;color:#6b5d4f}
</style></head><body>
<script>
(function(){
 var tool="corpus_search";
 function h(){ parent.postMessage({type:"mcp-ui:height",
   height:document.documentElement.scrollHeight+8},"*"); }
 function esc(s){var d=document.createElement("div");d.textContent=s==null?"":s;return d.innerHTML;}
 function attr(s){return esc(s).replace(/"/g,"&quot;");}
 function render(hits){
   hits=Array.isArray(hits)?hits:[];
   var label=(tool==="corpus_list"?"browsed":"searched")+" · "+hits.length+" entries";
   var rows=hits.map(function(x){
     var g=x.genre==="output"?"genre out":"genre";
     var sum=x.summary?'<span class="summary">'+esc(x.summary)+'</span>':'';
     return '<li data-testid="tool-card-hit" data-path="'+attr(x.path)+'">'+
       '<span class="'+g+'">'+esc(x.genre)+'</span>'+
       '<span class="title">'+esc(x.title)+'</span>'+sum+'</li>';
   }).join("");
   document.body.innerHTML='<details data-testid="tool-card-'+tool+'">'+
     '<summary>'+esc(label)+'</summary><ul>'+rows+'</ul></details>';
   document.querySelector("details").addEventListener("toggle",h);
 }
 window.addEventListener("message",function(e){
   if(e.data&&e.data.type==="mcp-ui:data"){
     if(typeof e.data.tool==="string"&&e.data.tool)tool=e.data.tool;
     render(e.data.data); h();
   }
 });
 parent.postMessage({type:"mcp-ui:ready"},"*");
})();
</script></body></html>`
