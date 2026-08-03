// corpus_index_deps.go —— corpus 检索/导航 host 侧窄依赖(四类 lister)。

package usecase

import (
	"github.com/atmaxmoj/standmeet/internal/corpus/repo"
	"github.com/atmaxmoj/standmeet/internal/corpus/search"
)

// IndexDeps —— 窄依赖(#131):corpus 四类 lister(wiki/output/writing/subjectivity)。
// composition root 建一份喂 RegisterCorpusIndexSocket。
type IndexDeps struct {
	Wiki         WikiLister
	Output       OutputLister
	Writings     WritingLister
	Subjectivity *repo.NoteRepo
	VaultSync    *repo.VaultSyncRepo // standmeet-query 解析 + corpus_links 取邻居 genre/path
	NoteRefs     *repo.NoteRefRepo   // corpus_links 顺 note_refs 取 outgoing/backlinks
	Searcher     *search.Client      // Meili 词法后端;nil → corpus_search 退 Postgres 全文
	// Media —— 素材(图 / 附件 / hero)。访客读到一条语料时顺带给出去 —— 可见性纯继承。
	Media *NoteAssetsDeps
}
