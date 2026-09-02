// page_content.go —— the full content of the owner's public page. Each
// section stays a typed struct (both frontend and admin editing follow
// this shape) so jsonb never leaks up to the layers above.
// Design J / docs/design/project/page-content.js is the source of field
// semantics.
//
// This is the Owner aggregate's "content facet" — parallel to Settings,
// travels through the repo along with owner_id; not its own aggregate
// root.

package entity

import (
	"errors"
	"time"
)

// PageContent —— the full content of the owner's public page (stored
// form). insights / projects no longer store content directly, they store
// a **pin list** (wiki entry UUIDs, array order = display order) — an
// idea is stored exactly once, and the homepage is a window onto the
// corpus (docs/design/page-corpus-pinning.md). Rendering joins in
// title+excerpt (PagePinCard).
// Field order follows govet fieldalignment: time.Time first (internal ptr
// at 16) + nested structs + strings + slices last, to keep the last
// pointer offset small.
type PageContent struct {
	UpdatedAt    time.Time   `json:"updated_at"`
	Where        PageWhere   `json:"where"`
	Contact      PageContact `json:"contact"`
	OwnerID      string      `json:"owner_id"`
	HeroProse    string      `json:"hero_prose"`
	HeroExamples []string    `json:"hero_examples"`
	Insights     []string    `json:"insights"`
	Projects     []string    `json:"projects"`
}

// PagePinCard —— the card rendered from one pin: the pinned entry's title
// + excerpt + tree-derived path (frontend links to /wiki/<path>). The
// invariant pinned ⊆ published is maintained by the write side; this is
// just the join result.
type PagePinCard struct {
	WikiID  string `json:"wiki_id"`
	Title   string `json:"title"`
	Excerpt string `json:"excerpt"`
	Path    string `json:"path"`
}

// ErrPinUnpublished —— pinning an entry that isn't published; the write
// point rejects it ("publish it first"), the other end of the invariant
// (unpublish → auto-unpin) is maintained in the seo usecase.
var ErrPinUnpublished = errors.New("entry is not published; publish it first")

// ErrPinNotFound —— the pin's wiki_id doesn't exist (or doesn't belong to
// this owner).
var ErrPinNotFound = errors.New("pinned entry not found")

// PageWhere —— the "where I am" section (status + looking-for + closing).
// Field order follows govet fieldalignment: strings first, slice last
// (slice ptr at offset 0).
type PageWhere struct {
	LocationLine string   `json:"location_line"`
	StatusProse  string   `json:"status_prose"`
	Closing      string   `json:"closing"`
	LookingFor   []string `json:"looking_for"`
}

// PageContact —— contact section (email + multiple prose blocks).
type PageContact struct {
	Email          string `json:"email"`
	ChatLine       string `json:"chat_line"`
	RecruiterProse string `json:"recruiter_prose"`
	CasualProse    string `json:"casual_prose"`
}

// ErrPageNotFound —— page_content row not found; usecase layer returns a
// default.
var ErrPageNotFound = errors.New("page content not found")
