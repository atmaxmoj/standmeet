// corpus_index_deps.go — corpus retrieval/navigation host-side narrow deps (four listers).

package usecase

import (
	"github.com/atmaxmoj/standmeet/internal/corpus/repo"
	"github.com/atmaxmoj/standmeet/internal/corpus/search"
)

// IndexDeps — narrow deps (#131): the corpus's four listers (wiki/output/writing/subjectivity).
// The composition root builds one instance and feeds it to RegisterCorpusIndexSocket.
type IndexDeps struct {
	Wiki         WikiLister
	Output       OutputLister
	Writings     WritingLister
	Subjectivity *repo.NoteRepo
	// VaultSync resolves standmeet-query and looks up a neighbor's genre/path via corpus_links.
	VaultSync *repo.VaultSyncRepo
	// NoteRefs follows note_refs via corpus_links to fetch outgoing links/backlinks.
	NoteRefs *repo.NoteRefRepo
	// Searcher is the Meili lexical backend; nil falls back to Postgres full-text in corpus_search.
	Searcher *search.Client
	// Media — assets (images / attachments / hero). Handed out alongside a corpus item when a
	// visitor reads it — visibility is purely inherited.
	Media *NoteAssetsDeps
}
