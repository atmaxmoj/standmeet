// retrieval-mcp.js — the corpus.retrieval block as a stdio-MCP server, in JS (cross-platform).
//
// Replaces mcp-servers/retrieval (Go) verbatim. Owns NO data: each tool forwards to the identically
// named host op (corpus_search / corpus_read / …) over STANDMEET_HOST_SOCKET, carrying owner id +
// conversation id + the OPAQUE frozen corpus-ACL scope off the tool `_meta`, and returns the host's
// JSON wire straight through. The corpus_scope is opaque here on purpose — a courier that reads the
// envelope is a courier that can lose part of the letter. All tools are safe reads (readOnlyHint).

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js')
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js')
const { z } = require('zod')
const { callHost } = require('./gateway.js')

const searchCardURI = 'ui://retrieval/search-card.html'
const searchCardMIME = 'text/html'

const instructions = `The owner's corpus is a LINKED TREE of notes: every node is itself a note (it has a body) AND a parent of finer nodes, addressed by path (e.g. cybernetics/theory/ashby). Notes reference each other with [[wikilinks]]. Your tools:
  • corpus_map(under?, budget?) — a birds-eye skeleton: the high-level node tree with a count under each branch. Shows WHERE the material is.
  • corpus_list(path?)          — the direct children of one node (omit path = roots).
  • corpus_resolve(name)        — a [[link]] target or title → its exact path (don't guess a path).
  • corpus_search(query)        — keyword search across the corpus: ranked, typo-tolerant, and it can MISS text its tokenizer does not cut (a fragment inside a word, a punctuation-glued token).
  • corpus_grep(pattern)        — every place an exact string / regex occurs, with the matching lines. Exhaustive: if it is there, this finds it. Use when the exact words matter, or when search came back empty and you need certainty.
  • corpus_peek(paths[])        — cheap preview of MANY nodes (title, tags, headings, outlinks, first line) without their full bodies — to triage.
  • corpus_read(path)           — the full body of one node.
  • corpus_links(path)          — a node's outgoing links + backlinks (one hop).

Strategy — don't search blind:
  1. On a BROAD question ("themes across your work", "what do you think about X"), call corpus_map FIRST to see the shape, then read the big branch nodes.
  2. Reading a node gives you that branch's overview; go deeper with corpus_list (its children) and by following its [[links]] with corpus_links / corpus_resolve.
  3. After a map or a wide search, corpus_peek several candidate paths at once, then corpus_read only the few worth the full body.
  4. When a note links to [[some-name]], resolve or follow it rather than guessing its path.
Ground your answer in what you actually read. Quote output entries verbatim when they fit; paraphrase wiki entries.`

const searchCardHTML = `<!doctype html><html><head><meta charset="utf-8">
<style>
 :root{--ink:#1B1814;--muted:#6b5d4f;--faint:#8a7c6a;--accent:#B5391C;--rule:#d9d0c2;
   font-family:ui-serif,Georgia,serif;color:var(--ink)}
 body{margin:0;padding:4px 2px}
 details{font:13px ui-serif,Georgia,serif}
 summary{font:600 12px ui-monospace,monospace;cursor:pointer;list-style:none;
   color:var(--muted);padding:2px 0;user-select:none}
 summary::-webkit-details-marker{display:none}
 summary:hover{color:var(--accent)}
 ul{list-style:none;margin:6px 0 0;padding:0;border-top:1px solid var(--rule)}
 li{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px;padding:6px 0;
   border-bottom:1px solid var(--rule)}
 .genre{font:11px ui-monospace,monospace;color:var(--faint);text-transform:uppercase}
 .genre.out{color:var(--accent)}
 .title{font-weight:600}
 .summary{flex-basis:100%;font-size:12px;color:var(--muted)}
</style></head><body>
<script>
(function(){
 var tool="corpus_search";
 function h(){ parent.postMessage({type:"mcp-ui:height",
   height:document.documentElement.scrollHeight+8},"*"); }
 // theme —— the host page's design tokens, so the card matches a dark page.
 function theme(t){ if(!t||typeof t!=="object")return;
   Object.keys(t).forEach(function(k){
     if(typeof t[k]==="string")document.documentElement.style.setProperty("--"+k,t[k]); }); }
 function esc(s){var d=document.createElement("div");d.textContent=s==null?"":s;return d.innerHTML;}
 function attr(s){return esc(s).replace(/"/g,"&quot;");}
 // render —— the tool returns {hits, note?} (a bare array in older builds). Reading only the bare
 // array made every search read "searched · 0 entries" (prod 2026-09-25).
 function render(d){
   var hits=Array.isArray(d)?d:(d&&Array.isArray(d.hits)?d.hits:[]);
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
     theme(e.data.theme); render(e.data.data); h();
   }
 });
 parent.postMessage({type:"mcp-ui:ready"},"*");
})();
</script></body></html>`

// forward — the generic op handler: owner id + conversation id + OPAQUE corpus scope off `_meta` +
// the raw tool arguments → the named host op; the host's JSON wire is the agent-facing result.
function forward(op) {
  return async (args, extra) => {
    const s = (extra && extra._meta && extra._meta['standmeet/session']) || {}
    try {
      const resp = await callHost({
        op,
        owner_id: s.owner_id || '',
        conversation_id: s.conversation_id || '',
        corpus_scope: s.corpus_scope,
        args: args || {},
      })
      return { content: [{ type: 'text', text: resp }] }
    } catch (e) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: e.message }) }] }
    }
  }
}

const readOnly = { readOnlyHint: true }

async function main() {
  const server = new McpServer(
    { name: 'retrieval', version: '1.0.0' },
    { instructions, capabilities: { tools: {}, resources: {} } },
  )

  server.registerTool('corpus_search', {
    description:
      "Search owner's curated corpus by keyword. Returns {hits, note?}: hits are the " +
      'matching wiki + output entries with path, title, genre, summary. This is a ' +
      'lexical index, so a hit depends on tokenization: substrings inside a word, ' +
      'terms glued to punctuation, and CJK bigrams can all miss. An empty result ' +
      'therefore does NOT mean the corpus lacks the topic — when hits is empty the ' +
      'result carries a note saying so. If you still believe the material exists, ' +
      'use corpus_grep, which is literal and never-miss. Results are paged: limit ' +
      'caps how many come back (default 20, max 50), offset skips that many.',
    // limit/offset must be declared here or the MCP inputSchema strips them before they reach the
    // host — which left the search widget's `limit: 8` ignored and every hit rendered at once.
    inputSchema: {
      query: z.string(),
      limit: z.number().int().optional(),
      offset: z.number().int().optional(),
    },
    annotations: readOnly,
    _meta: { progress_label: 'searching corpus', ui_resource: searchCardURI },
  }, forward('corpus_search'))

  server.registerTool('corpus_read', {
    description:
      'Read the full body of a corpus entry by its path (e.g. projects/lucerna). Use after search to fetch content.',
    inputSchema: { path: z.string() },
    annotations: readOnly,
    _meta: { progress_label: 'reading entry' },
  }, forward('corpus_read'))

  server.registerTool('corpus_list', {
    description:
      'Navigate the wiki tree one level at a time. Omit path to list root entries; ' +
      "pass a node's path to list its direct children (empty result means it's a " +
      'leaf). Use page (0-based) to page through a wide level.',
    inputSchema: { path: z.string().optional(), page: z.number().int().optional() },
    annotations: readOnly,
    _meta: { progress_label: 'listing entries', ui_resource: searchCardURI },
  }, forward('corpus_list'))

  server.registerTool('corpus_links', {
    description:
      "Follow an entry's links (Obsidian-style). Given a path, returns its outgoing " +
      'links (entries it references) and backlinks (entries that reference it). ' +
      'One hop only — call again on a neighbor to go deeper. Use to explore related ' +
      'notes the owner connected by hand.',
    inputSchema: { path: z.string() },
    annotations: readOnly,
    _meta: { progress_label: 'following links' },
  }, forward('corpus_links'))

  server.registerTool('corpus_map', {
    description:
      'Get a birds-eye SKELETON of the corpus: the high-level node tree with a count of ' +
      'entries under each. Call this FIRST on a broad question — it shows where the ' +
      "material is (which branches are big) so you don't search blind. Omit `under` for " +
      'the whole corpus, or pass a node path to zoom into that branch. `budget` bounds ' +
      'the size (default is a screenful); dense branches are expanded, sparse ones stay ' +
      'collapsed with their count — drill a collapsed branch with corpus_map(under=path) ' +
      'or corpus_list.',
    inputSchema: { under: z.string().optional(), budget: z.number().int().optional() },
    annotations: readOnly,
    _meta: { progress_label: 'mapping corpus' },
  }, forward('corpus_map'))

  server.registerTool('corpus_resolve', {
    description:
      'Turn a NAME into its exact node path. When a note body links to [[some-note]] or ' +
      'you know a title but not its path, resolve the name here instead of guessing a ' +
      'path (a wrong path wastes a round). Returns 0+ matching nodes with their paths.',
    inputSchema: { name: z.string() },
    annotations: readOnly,
    _meta: { progress_label: 'resolving name' },
  }, forward('corpus_resolve'))

  server.registerTool('corpus_peek', {
    description:
      'Cheaply preview MANY nodes at once: pass a list of paths, get each node\'s title, ' +
      'tags, heading outline, outgoing [[links]], and first line — WITHOUT the full body. ' +
      'Use to triage which nodes are worth a full corpus_read after a map or a wide ' +
      'search, instead of reading each one blind.',
    inputSchema: { paths: z.array(z.string()) },
    annotations: readOnly,
    _meta: { progress_label: 'peeking nodes' },
  }, forward('corpus_peek'))

  server.registerTool('corpus_grep', {
    description:
      'Find EVERY place an exact string or regex occurs in the corpus, with the matching ' +
      'lines. Exhaustive, not ranked: if the pattern is in a note you can read, that ' +
      'note is in the result — no typo tolerance, no stemming, no scoring. Use it when ' +
      'the exact words matter (a name, an error string, a phrase you remember ' +
      'verbatim, a mid-word fragment), or when corpus_search returned nothing and you ' +
      'need certainty rather than another guess. Set fixed:true to search for the ' +
      'pattern literally (e.g. "C++", "a.b").',
    inputSchema: {
      pattern: z.string().describe('RE2 regex, or a literal string with fixed:true.'),
      fixed: z.boolean().optional().describe('Treat the pattern as literal text, not a regex.'),
      case_sensitive: z.boolean().optional().describe('Default false — matching ignores case.'),
    },
    annotations: readOnly,
    _meta: { progress_label: 'grepping corpus' },
  }, forward('corpus_grep'))

  server.registerResource(
    'corpus hits card',
    searchCardURI,
    { mimeType: searchCardMIME, description: 'Sandboxed corpus_search/corpus_list hits list.' },
    async () => ({ contents: [{ uri: searchCardURI, mimeType: searchCardMIME, text: searchCardHTML }] }),
  )

  await server.connect(new StdioServerTransport())
}

main().catch((e) => {
  console.error(e) // stderr only — stdout is the JSON-RPC channel
  process.exit(1)
})
