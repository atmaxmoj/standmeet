// corpus_row.go — the wire row for corpus_search / corpus_list (owned by
// corpus, used for socket serialization).

package usecase

// Row — the wire row for corpus_search / corpus_list. summary is filled only
// by search (omitempty).
type Row struct {
	Path    string `json:"path"`
	Title   string `json:"title"`
	Genre   string `json:"genre"`
	Summary string `json:"summary,omitempty"`
}
