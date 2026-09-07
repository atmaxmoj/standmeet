// resume_draft.go — ResumeDraft aggregate: the Phase 2 intermediate state. Once Claude
// hands back resume_content the owner is still previewing it; commit turns it into an
// application (Phase 3).
//
// L.13 decision: the draft already copies the job snapshot in at creation time, so commit
// doesn't depend on the Redis TTL still being alive — commit still works after the pool
// has evicted the entry.
//
// The PDF is always ephemeral — each MCP call renders the bytes on the spot with gopdf and
// stuffs them into the response; the server stores no file, and the draft table has no
// PDF path column.

package jobsmodel

import (
	"encoding/json"
	"errors"
	"time"
)

// ResumeDraft — a DB-backed draft row (jsonb job_snapshot + resume_content already
// decoded into their domain types).
type ResumeDraft struct {
	CreatedAt  time.Time
	ExpiresAt  time.Time
	ID         string
	OwnerID    string
	JobCacheID string
	// Template — the Typst layout this draft picked ('' = default classic). A
	// customization choice, carried into the PDF at commit.
	Template string
	// PuckData — the Puck editor's own state JSON, passed through verbatim (the backend never
	// interprets it). Nil = never opened+Saved in the Puck editor (agent-created or pre-Puck);
	// the editor derives it from ResumeContent on open. Always rederivable from ResumeContent.
	PuckData    json.RawMessage
	JobSnapshot FetchedJob
	// ResumeContent last (trailing non-pointer float64 → minimal pointer-scan prefix).
	ResumeContent ResumeContent
}

// CreateResumeDraftInput — the usecase-layer input for draft.create (the job snapshot has
// already been pulled from the Redis pool and injected by the caller).
type CreateResumeDraftInput struct {
	OwnerID     string
	JobCacheID  string
	Template    string
	JobSnapshot FetchedJob
	// ResumeContent last (trailing non-pointer float64 → minimal pointer-scan prefix).
	ResumeContent ResumeContent
}

// ResumeDraft-scoped sentinels.
var (
	// ErrResumeDraftNotFound — lookup by (id, owner_id) missed, or it's expired and got
	// filtered out by the expires_at filter.
	ErrResumeDraftNotFound = errors.New("resume draft not found")
	// ErrResumeContentInvalid — content validation failed (a required field is missing).
	ErrResumeContentInvalid = errors.New("resume content invalid")
)
