// application.go — Application aggregate (Phase 3 persisted record).
//
// Every application has exactly one AccessCode issued synchronously with it (a
// recruiter scans the QR code and lands back in visitor chat). job_snapshot and
// resume_content are snapshots taken at the moment of commit, so the application
// loses no information even after the corresponding draft is deleted or the
// Redis pool entry is evicted.
//
// status values (v1): 'pending' (owner committed but hasn't submitted it yet) →
// 'submitted' (Playwright submitted it successfully) → 'failed' / 'withdrawn'.
// Phase 3 only uses 'pending'; Phase 4's successful Playwright submission backfills
// submitted_at + status.

package jobsmodel

import (
	"errors"
	"time"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
)

// Application — DB-backed application row.
type Application struct {
	CreatedAt    time.Time
	SubmittedAt  *time.Time
	ID           string
	OwnerID      string
	AccessCodeID string
	Status       string
	// Template — which Typst layout this resume uses ('' = default classic).
	// A customization option.
	Template      string
	ResumeContent ResumeContent
	JobSnapshot   FetchedJob
}

// CreateApplicationInput — usecase-layer input for application.commit.
// access_code has already been issued earlier in the same tx; the caller passes in its ID.
type CreateApplicationInput struct {
	OwnerID       string
	AccessCodeID  string
	ResumeContent ResumeContent
	JobSnapshot   FetchedJob
}

// CommittedApplication — applications.commit's return value: the application + the
// synchronously issued AccessCode (plaintext code for the QR URL) + the final PDF bytes.
type CommittedApplication struct {
	Application Application
	AccessCode  access.Code
	QRURL       string
	// Warning — it went out, but there's something the owner should know (empty = nothing).
	// Today there's only one case: the hiring role references a CV note that doesn't
	// exist — a recruiter asking about the employer and dates gets told "not in the
	// notes". This does NOT block submission; it just stops the gap from being silent.
	Warning string
	PDF     []byte
}

// ErrApplicationNotFound — lookup by (id, owner_id) found no match.
var ErrApplicationNotFound = errors.New("application not found")
