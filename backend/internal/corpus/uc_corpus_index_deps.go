// uc_corpus_index_deps.go —— corpus 检索/导航 host 侧窄依赖(四类 lister)。

package corpus

import "github.com/atmaxmoj/standmeet/internal/search"

// IndexDeps —— 窄依赖(#131):corpus 四类 lister(wiki/output/writing/subjectivity)。
// composition root 建一份喂 RegisterCorpusIndexSocket。
type IndexDeps struct {
	Wiki         WikiLister
	Output       OutputLister
	Writings     WritingLister
	Subjectivity *NoteRepo
	VaultSync    *VaultSyncRepo // standmeet-query 解析 + corpus_links 取邻居 genre/path
	NoteRefs     *NoteRefRepo   // corpus_links 顺 note_refs 取 outgoing/backlinks
	Searcher     *search.Client // Meili 词法后端;nil → corpus_search 退 Postgres 全文
}
