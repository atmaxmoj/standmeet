// corpus_deps.go — the corpus domain's deps struct, built once on the assembly root side.
//
// It used to be assembled separately in three places (owner-MCP's deps, admin's deps, the
// dispatcher's adapter); as the fields grew, "this copy is missing a repo" discrepancies would
// creep in — a discrepancy that doesn't fail to compile, only shows up at runtime as some
// feature quietly not working.

package wire

import (
	"github.com/atmaxmoj/standmeet/cmd/server/deps"
	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
)

func corpusDepsOf(d *deps.Runtime) corpus.Deps {
	return corpus.Deps{
		Raw: d.RawRepo, Wiki: d.WikiRepo, Output: d.OutputRepo, NoteRefs: d.NoteRefRepo,
		Subjectivity: d.SubjectivityRepo, Index: d.CorpusIndexer,
		// Media: an entry of any genre can carry images / attachments / a hero image.
		Media: &corpus.NoteAssetsDeps{
			Assets: corpus.AssetsDeps{Repo: d.AssetRepo, Storage: d.StorageClient},
			Hero:   d.NoteHeroRepo,
		},
	}
}
