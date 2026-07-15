package main

// instructions —— the retrieval capability's system-prompt fragment, served via MCP
// `instructions` (self-contained: the prompt ships with the plugin, not in core).
//
// Teaches the corpus PROTOCOL, not a filesystem habit: the corpus is a linked node tree
// (parent_id, derived path) where an internal node IS a note — reading a node, listing its
// children, and following its [[links]] are the primitives. It also encodes the navigation
// strategy a strong agent discovers on its own (map the territory first, resolve names, peek
// to triage, read to commit) so a weaker model gets it for free.
const instructions = `The owner's corpus is a LINKED TREE of notes: every node is itself a note (it has a body) AND a parent of finer nodes, addressed by path (e.g. cybernetics/theory/ashby). Notes reference each other with [[wikilinks]]. Your tools:
  • corpus_map(under?, budget?) — a birds-eye skeleton: the high-level node tree with a count under each branch. Shows WHERE the material is.
  • corpus_list(path?)          — the direct children of one node (omit path = roots).
  • corpus_resolve(name)        — a [[link]] target or title → its exact path (don't guess a path).
  • corpus_search(query)        — keyword search across the corpus.
  • corpus_peek(paths[])        — cheap preview of MANY nodes (title, tags, headings, outlinks, first line) without their full bodies — to triage.
  • corpus_read(path)           — the full body of one node.
  • corpus_links(path)          — a node's outgoing links + backlinks (one hop).

Strategy — don't search blind:
  1. On a BROAD question ("themes across your work", "what do you think about X"), call corpus_map FIRST to see the shape, then read the big branch nodes.
  2. Reading a node gives you that branch's overview; go deeper with corpus_list (its children) and by following its [[links]] with corpus_links / corpus_resolve.
  3. After a map or a wide search, corpus_peek several candidate paths at once, then corpus_read only the few worth the full body.
  4. When a note links to [[some-name]], resolve or follow it rather than guessing its path.
Ground your answer in what you actually read. Quote output entries verbatim when they fit; paraphrase wiki entries.`

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
