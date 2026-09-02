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
	"errors"
	"time"
)

// ResumeDraft — a DB-backed draft row (jsonb job_snapshot + resume_content already
// decoded into their domain types).
type ResumeDraft struct {
	CreatedAt     time.Time
	ExpiresAt     time.Time
	ResumeContent ResumeContent
	ID            string
	OwnerID       string
	JobCacheID    string
	// Template — the Typst layout this draft picked ('' = default classic). A
	// customization choice, carried into the PDF at commit.
	Template    string
	JobSnapshot FetchedJob
}

// CreateResumeDraftInput — the usecase-layer input for draft.create (the job snapshot has
// already been pulled from the Redis pool and injected by the caller).
type CreateResumeDraftInput struct {
	ResumeContent ResumeContent
	OwnerID       string
	JobCacheID    string
	Template      string
	JobSnapshot   FetchedJob
}

// ResumeDraft-scoped sentinels.
var (
	// ErrResumeDraftNotFound — lookup by (id, owner_id) missed, or it's expired and got
	// filtered out by the expires_at filter.
	ErrResumeDraftNotFound = errors.New("resume draft not found")
	// ErrResumeContentInvalid — content validation failed (a required field is missing).
	ErrResumeContentInvalid = errors.New("resume content invalid")
)
