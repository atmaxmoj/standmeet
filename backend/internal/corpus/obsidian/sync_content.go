// sync_content.go — what a node "should end up as": content derived from the vault
// file, and what to do about fields the vault never mentioned. Split out of sync.go
// to stay under the max-lines-350 limit.
//
// The reconcile action lives in sync.go; this file only answers "what is desired".

package obsidian

// nodeContent — the persisted content for one node; file==nil (an auto-filled
// intermediate node) = an empty structural node.
type nodeContent struct {
	langLabels map[string]string
	body       string
	excerpt    string
	srcPath    string
	// rawFM —— the raw text of the vault's frontmatter block. Keys the product
	// doesn't recognize, and their exact form, live only here; export writes
	// them back verbatim, or one sync deletes keys the owner wrote by hand (F-L-67).
	rawFM      string
	lang       string
	tags       []string
	cssClasses []string
	aliases    []string
	published  bool
	// publishSet —— whether the vault actually said anything (see corpFM.PublishSet).
	// When it didn't, this published field doesn't count — fill it from the value
	// already in the DB instead (keepPublish).
	publishSet bool
}

func contentOf(n *desiredNode) nodeContent {
	if n.file == nil {
		return nodeContent{}
	}
	return nodeContent{
		body: n.file.body, excerpt: n.file.fm.Excerpt, srcPath: n.file.sourcePath,
		rawFM: n.file.rawFM,
		tags:  n.file.fm.Tags, cssClasses: n.file.fm.CSSClasses,
		aliases: n.file.fm.Aliases, published: n.file.fm.Publish,
		publishSet: n.file.fm.PublishSet,
		lang:       n.file.fm.Lang, langLabels: n.file.fm.LangLabels,
	}
}

// keepPublish — when frontmatter doesn't mention publish, carry forward this
// note's current value.
//
// Treating "absent = false" would let a routine sync unpublish everything the owner
// published on the web, when the vault never expressed a negative intent (F-L-22):
// the real vault's 574 wiki notes carry no publish key at all — publishing is a web
// edit. A newly created note has no "current value", so false is the right default
// only in that case.
//
// The other half — writing it back — lives in export (export_corpus.go writes
// `publish: %t`): if it's missing, fill it in, so the next round trip is explicit.
func keepPublish(c *nodeContent, existing bool) {
	if !c.publishSet {
		c.published = existing
	}
}

// inboxSourceFor — a genre='raw' node carries the vault-origin tag
// "obsidian:<srcPath>"; other genres get empty. Lands in corpus_notes.inbox_source
// (the conflict key for vault raw's idempotent upsert).
func inboxSourceFor(genre string, c *nodeContent) string {
	if genre == genreRaw && c.srcPath != "" {
		return "obsidian:" + c.srcPath
	}
	return ""
}
