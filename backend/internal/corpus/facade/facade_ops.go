// facade_ops.go — the actions this domain exposes outward, re-exported for the convergence point.
//
// Still just a facade: aliases only. Declared in internal/corpus/ops; the convergence point
// imports this file to gather them.

package corpus

import "github.com/atmaxmoj/standmeet/internal/corpus/ops"

// Types needed when declaring operations (implemented in: ops).
type OpsWritingsDeps = ops.WritingsDeps

// Operation groups (implemented in: ops).
var (
	AssetOps        = ops.AssetOps
	CorpusReadOps   = ops.CorpusReads
	CorpusSearchOps = ops.CorpusSearch
	CorpusWriteOps  = ops.CorpusWrites
	CorpusI18nOps   = ops.I18nOps
	SubjectivityOps = ops.Subjectivity
	WritingOps      = ops.Writings
)
