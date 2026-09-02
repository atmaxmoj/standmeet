// raw.go —— the "half-finished" corpus entry the owner pushes up via MCP (pre-curate).
//
// LSP contract (shared across all 4 Genres):
//   - Raw.Title() is always "" (the Raw shape has no title concept)
//   - Raw.UpdatedAt() == Raw.CreatedAt() (Raw is immutable post-dump, no separate
//     update time)
//   - Raw.IsPublished() is always false (Raw has no publish concept)
//   - Raw.Integrations() currently returns an empty slice, but the schema supports
//     future syncing from clipboard / IM bridge into Raw with an integration
//     attached, without touching the interface
//
// Raw-specific fields (not in the Document interface): Source / FlaggedPrivate /
// Archived / PromotedTo — for callers that type-assert back to Raw.

package entity

import (
	"errors"
	"time"

	"github.com/atmaxmoj/standmeet/internal/connector"
)

// Raw —— the "half-finished", uncurated entry the owner pushes into the corpus via MCP.
type Raw struct {
	timestamps     Timestamps
	promotedTo     *string
	parentID       *string
	id             string
	ownerID        string
	source         string
	content        Content
	integrations   connector.Integrations
	flaggedPrivate bool
	archived       bool
}

// RawInit —— constructor params (used by the postgres mapper).
type RawInit struct {
	CreatedAt      time.Time
	PromotedTo     *string
	ParentID       *string
	ID             string
	OwnerID        string
	Title          string
	Body           string
	Source         string
	Tags           []string
	Integrations   connector.Integrations
	FlaggedPrivate bool
	Archived       bool
}

// NewRaw —— constructs from Init. PromotedTo is defensive-copied. Timestamps
// automatically feeds CreatedAt into updatedAt too (the Raw-immutable LSP contract).
// Pointer param avoids hugeParam.
func NewRaw(i *RawInit) Raw {
	var promotedTo *string
	if i.PromotedTo != nil {
		v := *i.PromotedTo
		promotedTo = &v
	}
	var parentID *string
	if i.ParentID != nil {
		v := *i.ParentID
		parentID = &v
	}
	return Raw{
		id:             i.ID,
		ownerID:        i.OwnerID,
		source:         i.Source,
		flaggedPrivate: i.FlaggedPrivate,
		archived:       i.Archived,
		promotedTo:     promotedTo,
		parentID:       parentID,
		content: NewContent(&ContentInit{
			Title: i.Title, Body: i.Body, Tags: i.Tags,
		}),
		timestamps: NewTimestamps(&TimestampsInit{
			CreatedAt: i.CreatedAt, UpdatedAt: i.CreatedAt,
		}),
		integrations: i.Integrations,
	}
}

// --- Document interface implementation (flat forwarding) ---

// URI —— raw://<uuid>.
func (r *Raw) URI() string { return FormatURI(GenreRaw, r.id) }

// Genre —— always returns GenreRaw.
func (*Raw) Genre() DocumentGenre { return GenreRaw }

// ID —— DB primary key.
func (r *Raw) ID() string { return r.id }

// OwnerID —— the corpus is always owner-scoped.
func (r *Raw) OwnerID() string { return r.ownerID }

// Title —— Raw has no title, always "".
func (r *Raw) Title() string { return r.content.Title() }

// Body —— the raw text that was dumped in.
func (r *Raw) Body() string { return r.content.Body() }

// Tags —— tag list (defensive copy), always non-nil.
func (r *Raw) Tags() []string { return r.content.Tags() }

// CreatedAt —— dump time.
func (r *Raw) CreatedAt() time.Time { return r.timestamps.CreatedAt() }

// UpdatedAt —— same as CreatedAt (the Raw-immutable LSP contract).
func (r *Raw) UpdatedAt() time.Time { return r.timestamps.UpdatedAt() }

// Integrations —— copy of the attached integrations (defensive copy), always non-nil.
func (r *Raw) Integrations() []connector.Integration { return r.integrations.All() }

// --- Raw-specific accessors ---

// Source —— the ingest source label (e.g. "claude-desktop" / "clipboard" / "mcp").
func (r *Raw) Source() string { return r.source }

// ParentID —— tree parent (raw is now a corpus_notes node); ok=false at the root. Mirrors Wiki.
func (r *Raw) ParentID() (string, bool) {
	if r.parentID == nil {
		return "", false
	}
	return *r.parentID, true
}

// FlaggedPrivate —— a dump the owner marked "private". The retriever skips these.
func (r *Raw) FlaggedPrivate() bool { return r.flaggedPrivate }

// Archived —— a dump the owner archived; excluded from retriever candidates.
func (r *Raw) Archived() bool { return r.archived }

// PromotedTo —— if this raw was promoted into a wiki/output, returns the target
// id; otherwise ("", false).
func (r *Raw) PromotedTo() (string, bool) {
	if r.promotedTo == nil {
		return "", false
	}
	return *r.promotedTo, true
}

// IsPromoted —— whether this was ever promoted. The semantic-named version of the
// PromotedTo() ok flag.
func (r *Raw) IsPromoted() bool { return r.promotedTo != nil }

// ErrRawNotFound —— lookup of a raw entry by id missed.
var ErrRawNotFound = errors.New("raw entry not found")
