// job_source.go — JobSource aggregate: the job source the owner registered (root) +
// JobFingerprint (child entity, used for dedup) + the create input DTO + source-scoped
// sentinels.
//
// FetchedJob is the value object the fetcher produces (Redis, 1d TTL, not persisted),
// see fetched_job.go. It references JobSource by ID but isn't part of this aggregate.
//
// Read alongside docs/design/job-loop.md.

package jobsmodel

import (
	"errors"
	"time"
)

// JobSource — the aggregate root. Kind determines the fetcher adapter; Config is
// raw JSON bytes shaped per-kind ({"company":"vercel"} / {"categories":
// [...]} / an empty object) — each adapter unmarshals its own into a typed struct, so the
// domain never touches a schemaless `any`.
type JobSource struct {
	CreatedAt time.Time
	// LastFetchedAt — when the last **successful** fetch happened.
	LastFetchedAt *time.Time
	// LastAttemptedAt / LastError — when the last **attempt** happened and its outcome
	// (empty string = succeeded). Without these two, "fetched but failing every time" reads
	// identically to "never fetched" in the UI (F-E-18).
	LastAttemptedAt *time.Time
	LastError       string
	ID              string
	OwnerID         string
	Kind            string
	Label           string
	Config          []byte
}

// JobFingerprint — a child entity inside the JobSource aggregate.
// Once (source_id, external_id) has been seen, it's never returned again; CASCADEs with
// its source on delete.
type JobFingerprint struct {
	FirstSeenAt time.Time
	SourceID    string
	ExternalID  string
}

// CreateJobSourceInput — the usecase-layer input for register_source.
// Config is raw JSON bytes (same shape as JobSource.Config).
type CreateJobSourceInput struct {
	OwnerID string
	Kind    string
	Label   string
	Config  []byte
}

// JobSource-scoped sentinels.
var (
	// ErrJobSourceNotFound — lookup by id missed (an owner mismatch also counts as a miss).
	ErrJobSourceNotFound = errors.New("job source not found")
	// ErrJobSourceKindInvalid — register_source was passed an invalid kind.
	ErrJobSourceKindInvalid = errors.New("job source kind invalid")
	// ErrJobSourceConfigInvalid — the config JSON shape doesn't match the kind
	// (missing required fields like company / categories).
	ErrJobSourceConfigInvalid = errors.New("job source config invalid")
)
