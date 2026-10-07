// corpus_owner_nav_desc.go —— the sentences the owner's AI reads for the navigation tools, and
// their input schemas. Worded as the visitor-side retrieval block words them
// (infra/plugins/retrieval/retrieval-mcp.js), with that block's tool names turned into the owner
// face's (corpus.read, corpus.list, corpus.search).

package usecase

import "encoding/json"

const mapToolDesc = "Get a birds-eye SKELETON of the corpus: the high-level node tree with a " +
	"count of entries under each. Call this FIRST when you land on this corpus or before filing " +
	"something new — it shows where the material is (which branches are big), so a note goes " +
	"next to its siblings instead of into a new pile. Omit `under` for the whole corpus, or pass " +
	"a node path to zoom into that branch. `budget` bounds the size (default is a screenful); " +
	"dense branches are expanded, sparse ones stay collapsed with their count — drill a " +
	"collapsed branch with corpus.map(under=path) or corpus.list."

const resolveToolDesc = "Turn a NAME into its exact node path. When a note body links to " +
	"[[some-note]] or you know a title but not its path, resolve the name here instead of " +
	"guessing a path. Returns 0+ matching nodes with their paths."

const peekToolDesc = "Cheaply preview MANY nodes at once: pass a list of paths, get each node's " +
	"title, tags, heading outline, outgoing [[links]], and first line — WITHOUT the full body. " +
	"Use to triage which nodes are worth a full corpus.get after a map or a wide search."

const grepToolDesc = "Find EVERY place an exact string or regex occurs in the corpus, with the " +
	"matching lines. Exhaustive, not ranked: if the pattern is in a note, that note is in the " +
	"result — no typo tolerance, no stemming, no scoring, no cap. Use it when the exact words " +
	"matter (a name, an error string, a phrase you remember verbatim, a mid-word fragment, CJK " +
	"text), or when corpus.search returned nothing and you need certainty rather than another " +
	"guess. Set fixed:true to search for the pattern literally (e.g. \"C++\", \"a.b\")."

const linksToolDesc = "Follow an entry's links (Obsidian-style). Given a path, returns its " +
	"outgoing links (entries it references) and backlinks (entries that reference it). One hop " +
	"only — call again on a neighbor to go deeper."

var (
	mapSchema = json.RawMessage(`{"type":"object","properties":{` +
		`"under":{"type":"string",` +
		`"description":"A node path to zoom into; omit for the whole corpus."},` +
		`"budget":{"type":"integer","description":"Size bound; default is a screenful."}}}`)
	resolveSchema = json.RawMessage(`{"type":"object","properties":{` +
		`"name":{"type":"string","description":"A [[link]] target or a title."}},` +
		`"required":["name"]}`)
	peekSchema = json.RawMessage(`{"type":"object","properties":{` +
		`"paths":{"type":"array","items":{"type":"string"}}},"required":["paths"]}`)
	grepSchema = json.RawMessage(`{"type":"object","properties":{` +
		`"pattern":{"type":"string",` +
		`"description":"RE2 regex, or a literal string with fixed:true."},` +
		`"fixed":{"type":"boolean",` +
		`"description":"Treat the pattern as literal text, not a regex."},` +
		`"case_sensitive":{"type":"boolean",` +
		`"description":"Default false — matching ignores case."}},` +
		`"required":["pattern"]}`)
	linksSchema = json.RawMessage(`{"type":"object","properties":{` +
		`"path":{"type":"string"}},"required":["path"]}`)
)
