// custom_page.go —— owner custom React page + sandbox vite build metadata.

package entity

import (
	"errors"
	"time"
)

// CustomPage —— owner custom React page.
type CustomPage struct {
	CreatedAt           time.Time
	UpdatedAt           time.Time
	LiveBuildID         *string
	StagingBuildID      *string
	PreviousLiveBuildID *string
	ID                  string
	OwnerID             string
	Slug                string
	Title               string
	Status              string // 'active' | 'archived' | 'deleted'
	// BoundCodes —— which **live** codes unlock this page (the other end of
	// the binding). Code→page is at most one, but page→code has no such
	// limit, so this is an array. Empty = no code points here, so it can
	// only be opened anonymously.
	BoundCodes []string
	// AllowBYOAI —— whether this page lets a reader use their own key when
	// no one has presented a grant. **A code overrides this**: the
	// presented grant decides everything (I-4).
	AllowBYOAI bool
	// StoreWritable —— whether visitors may WRITE this page's persistence store (security model C).
	// Default false: a page has zero write attack surface until its owner opens it.
	StoreWritable bool
}

// CustomPageBuild —— the state + output path of one sandbox vite build.
// Field order follows govet fieldalignment: time.Time first (internal
// ptr), then pointer, strings, map last.
type CustomPageBuild struct {
	CreatedAt    time.Time
	BuiltAt      *time.Time
	SourceFiles  map[string]string
	ID           string
	PageID       string
	Status       string // 'pending' | 'building' | 'built' | 'failed'
	OutputPath   string
	ErrorMessage string
}

// ErrCustomPageNotFound —— slug / id lookup found no custom_page.
var ErrCustomPageNotFound = errors.New("custom page not found")

// ErrCustomPageBuildNotFound —— build_id lookup found no build.
var ErrCustomPageBuildNotFound = errors.New("custom page build not found")

// ErrCustomPageSlugTaken —— an active page with this slug already exists
// under this owner.
var ErrCustomPageSlugTaken = errors.New("custom page slug already taken")
