// sync_content.go —— 一个节点「该落成什么样」:从 vault 文件派生的内容,以及 vault 没说的
// 那些字段该怎么办。从 sync.go 拆出来守 max-lines 350 的上限。
//
// reconcile 的动作在 sync.go;这里只回答「desired 是什么」。

package obsidian

// nodeContent —— 一个节点的落库内容;file==nil(自动补的中间节点)= 空结构节点。
type nodeContent struct {
	langLabels map[string]string
	body       string
	excerpt    string
	srcPath    string
	lang       string
	tags       []string
	cssClasses []string
	aliases    []string
	published  bool
	// publishSet —— vault 到底说了没有(见 corpFM.PublishSet)。没说时 published 这一格不作数,
	// 要用库里已有的值填(keepPublish)。
	publishSet bool
}

func contentOf(n *desiredNode) nodeContent {
	if n.file == nil {
		return nodeContent{}
	}
	return nodeContent{
		body: n.file.body, excerpt: n.file.fm.Excerpt, srcPath: n.file.sourcePath,
		tags: n.file.fm.Tags, cssClasses: n.file.fm.CSSClasses,
		aliases: n.file.fm.Aliases, published: n.file.fm.Publish,
		publishSet: n.file.fm.PublishSet,
		lang:       n.file.fm.Lang, langLabels: n.file.fm.LangLabels,
	}
}

// keepPublish —— frontmatter 没提 publish 时,沿用这条 note 现在的值。
//
// 「缺席 = false」会让一次例行同步把 owner 在网页上发布的东西全部撤下来,而 vault 从头到尾
// 没有表达过否定的意思(F-L-22):真 vault 的 574 条 wiki 一个 publish 键都没有,而发布是网页上
// 的编辑。新建的 note 没有「现在的值」,那时 false 才是对的默认。
//
// 补写回去的那一半在 export(export_corpus.go 写 `publish: %t`)—— 缺了就补上,下一次往返
// 就是显式的。
func keepPublish(c *nodeContent, existing bool) {
	if !c.publishSet {
		c.published = existing
	}
}

// inboxSourceFor —— genre='raw' 的节点带 vault 来源标签 "obsidian:<srcPath>";其它 genre 空。
// 落进 corpus_notes.inbox_source(vault raw 幂等 upsert 的 conflict key)。
func inboxSourceFor(genre string, c *nodeContent) string {
	if genre == genreRaw && c.srcPath != "" {
		return "obsidian:" + c.srcPath
	}
	return ""
}
