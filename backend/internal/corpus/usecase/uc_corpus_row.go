// uc_corpus_row.go —— corpus_search / corpus_list 的 wire 行(corpus 拥有,socket 序列化用)。

package usecase

// Row —— corpus_search / corpus_list 的 wire 行。summary 仅 search 填(omitempty)。
type Row struct {
	Path    string `json:"path"`
	Title   string `json:"title"`
	Genre   string `json:"genre"`
	Summary string `json:"summary,omitempty"`
}
