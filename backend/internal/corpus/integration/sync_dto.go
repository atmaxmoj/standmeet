// sync_dto.go — what goes into one sync, and what comes back out.
//
// Split from sync.go along a real seam: that file answers "what IS a sync source", this one
// "what does one sync carry". The three types here are pure data — no behaviour, no ports —
// and they are the layer's whole contract with the ingest usecase, which is why the composition
// root can adapt to and from them without either side importing the other.

package integration

// SyncFile —— one uploaded vault file (this layer's DTO; the composition root adapts to/from
// the ingest usecase's own type, keeping this layer free of a usecase import).
type SyncFile struct {
	RelPath string
	Body    []byte
}

// SyncResult —— ingest outcome (owner-facing counts + tolerant per-file errors).
type SyncResult struct {
	Errors  []string
	Created int
	Updated int
	Skipped int
	// Deleted —— rows removed because they are absent from an AUTHORITATIVE upload (see
	// SyncOpts).
	Deleted int
}

// SyncOpts —— what the uploaded file set means. Authoritative = "this is the WHOLE source", so
// the ingest may remove what is absent from it (sync converges the corpus on the source). A
// partial (the default zero value) must never delete: absence carries no information there. The
// two have opposite delete semantics and it cannot be inferred from the files, so the caller
// declares it.
type SyncOpts struct{ Authoritative bool }
