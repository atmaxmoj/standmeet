// resume_master.go — ResumeMaster: a named, persistent résumé (docs/design/resume-masters.md).
// resume_content only — no job, no access code, no expiry. Drafts (1 day) start from one.
//
// One wire shape: the admin REST face and the owner MCP face both encode this struct as-is, so the
// two cannot describe a master differently.

package jobsmodel

import (
	"errors"
	"time"
)

// ResumeMaster — one master row, content decoded.
type ResumeMaster struct {
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
	ID        string    `json:"id"`
	OwnerID   string    `json:"-"`
	Name      string    `json:"name"`
	// FromCompany — the company of the draft this master was last saved from ('' = none).
	FromCompany string `json:"from_company"`
	// ResumeContent before IsDefault (fieldalignment: the bool last packs tightest).
	ResumeContent ResumeContent `json:"resume_content"`
	IsDefault     bool          `json:"is_default"`
}

var (
	// ErrResumeMasterNotFound — lookup by (id, owner_id) missed.
	ErrResumeMasterNotFound = errors.New("resume master not found")
	// ErrResumeMasterNameRequired — a master is named; the owner picks it by name.
	ErrResumeMasterNameRequired = errors.New("resume master name is required")
)
