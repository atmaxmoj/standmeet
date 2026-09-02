// writing.go —— the "work" the owner publishes publicly (formerly Post / blog article).
//
// LSP contract (shared across all 4 Genres):
//   - Writing.Title() is non-empty (title is required when the owner saves)
//   - Writing.IsPublished() checks whether published_at is non-nil (other Genres
//     always return true)
//   - other methods follow the general Document convention
//
// Writing-specific fields: Slug / Path / Cover / Visibility / Excerpt /
// ReadMinutes / CrossRefs. Obsidian sync attaches through the generic
// Integrations mechanism (the former ObsidianSourcePath / ObsidianImportedAt
// fields now go through the Integration interface internally; callers get them
// via Integrations().Find(connector.IntegrationObsidian)).

package entity

import (
	"errors"
	"slices"
	"time"

	"github.com/atmaxmoj/standmeet/internal/connector"
)

// Writing —— value object for the writings table.
type Writing struct {
	timestamps   Timestamps
	cover        Cover
	visibility   Visibility
	id           string
	ownerID      string
	slug         string
	path         string
	excerpt      string
	parentID     string
	content      Content
	integrations connector.Integrations
	crossRefs    []string
	readMinutes  int32
	hasParent    bool
}

// WritingInit —— constructor params (used by the postgres mapper). Excerpt /
// ReadMinutes / CrossRefs are the few leaf fields unique to Writing, kept flat;
// everything else goes through a nested Init.
// fieldalignment: embedded Init big fields first, then slice, then string, int last.
type WritingInit struct {
	Timestamps   TimestampsInit
	Cover        CoverInit
	Visibility   VisibilityInit
	Path         string
	ID           string
	OwnerID      string
	Slug         string
	Title        string
	Excerpt      string
	Body         string
	ParentID     string
	Tags         []string
	CrossRefs    []string
	Integrations connector.Integrations
	ReadMinutes  int32
}

// NewWriting —— constructs from Init. CrossRefs is defensive-cloned. Each
// sub-object normalizes / defensive-copies internally on its own. Pointer param
// avoids hugeParam.
func NewWriting(i *WritingInit) Writing {
	refs := []string{}
	if len(i.CrossRefs) > 0 {
		refs = slices.Clone(i.CrossRefs)
	}
	return Writing{
		id:           i.ID,
		ownerID:      i.OwnerID,
		slug:         i.Slug,
		path:         i.Path,
		excerpt:      i.Excerpt,
		parentID:     i.ParentID,
		hasParent:    i.ParentID != "",
		readMinutes:  i.ReadMinutes,
		crossRefs:    refs,
		content:      NewContent(&ContentInit{Title: i.Title, Body: i.Body, Tags: i.Tags}),
		cover:        NewCover(&i.Cover),
		visibility:   NewVisibility(&i.Visibility),
		timestamps:   NewTimestamps(&i.Timestamps),
		integrations: i.Integrations,
	}
}

// --- Document interface (flat forwarding) ---

// URI —— writing://<slug>.
func (w *Writing) URI() string { return FormatURI(GenreWriting, w.slug) }

// Genre —— always returns GenreWriting.
func (*Writing) Genre() DocumentGenre { return GenreWriting }

// ID —— DB primary key.
func (w *Writing) ID() string { return w.id }

// OwnerID —— owner-scoped corpus FK.
func (w *Writing) OwnerID() string { return w.ownerID }

// Title —— the writing's title.
func (w *Writing) Title() string { return w.content.Title() }

// Body —— the writing's markdown body.
func (w *Writing) Body() string { return w.content.Body() }

// Tags —— tag list (defensive copy).
func (w *Writing) Tags() []string { return w.content.Tags() }

// CreatedAt —— creation time.
func (w *Writing) CreatedAt() time.Time { return w.timestamps.CreatedAt() }

// UpdatedAt —— last-updated time.
func (w *Writing) UpdatedAt() time.Time { return w.timestamps.UpdatedAt() }

// Integrations —— attached integration list (defensive copy), e.g. Obsidian sync.
func (w *Writing) Integrations() []connector.Integration { return w.integrations.All() }

// --- Writing-specific accessors ---

// Slug —— URL-friendly identifier, unique per owner.
func (w *Writing) Slug() string { return w.slug }

// Path —— the path used for the retriever URI (e.g. "writings/my-slug"). The
// postgres mapper assembles it and stuffs it into Init at SaveWriting time.
func (w *Writing) Path() string { return w.path }

// ParentID —— tree parent node id + whether it has one (root → "", false). Used
// by the reader sidebar's nesting and cycle validation. Same shape as Wiki.ParentID.
func (w *Writing) ParentID() (string, bool) { return w.parentID, w.hasParent }

// Excerpt —— short summary / chat answer summary / index card subtitle.
func (w *Writing) Excerpt() string { return w.excerpt }

// ReadMinutes —— estimated reading time (StripMarkdown counts words, divided by
// 225 wpm).
func (w *Writing) ReadMinutes() int32 { return w.readMinutes }

// CrossRefs —— related-article slug list (Writing-side relations), defensive copy.
func (w *Writing) CrossRefs() []string {
	return slices.Clone(w.crossRefs)
}

// Cover —— returns the cover sub-object (4 fields) as a whole.
func (w *Writing) Cover() Cover { return w.cover }

// Visibility —— returns the visibility sub-object as a whole.
func (w *Writing) Visibility() Visibility { return w.visibility }

// PublishedAt —— publish time (time, ok). ok=false when unpublished.
func (w *Writing) PublishedAt() (time.Time, bool) {
	return w.timestamps.PublishedAt()
}

// IsPublished —— whether it has been published.
func (w *Writing) IsPublished() bool { return w.timestamps.IsPublished() }

// Obsidian —— whether this writing was synced from an Obsidian vault; a
// type-assert helper so callers don't have to Find + assert every time.
// Returns (Obsidian{}, false) when it isn't from a vault.
func (w *Writing) Obsidian() (connector.Obsidian, bool) {
	in, ok := w.integrations.Find(connector.IntegrationObsidian)
	if !ok {
		return connector.Obsidian{}, false
	}
	ob, ok := in.(connector.Obsidian)
	return ob, ok
}

// HasObsidian —— the ok-only version of Obsidian().
func (w *Writing) HasObsidian() bool { return w.integrations.Has(connector.IntegrationObsidian) }

// CoverHeadline —— cover headline; a convenience so mapper / view code doesn't
// have to fetch Cover() first and then the field.
func (w *Writing) CoverHeadline() string { return w.cover.Headline() }

// CoverHue —— cover hue.
func (w *Writing) CoverHue() string { return w.cover.Hue() }

// CoverImageAssetID —— cover image asset id (empty string means none was set).
func (w *Writing) CoverImageAssetID() string { return w.cover.ImageAssetID() }

// VisibilityMode —— convenience for Visibility().Mode().
func (w *Writing) VisibilityMode() string { return w.visibility.Mode() }

// LockedBody —— convenience for Visibility().LockedBody().
func (w *Writing) LockedBody() string { return w.visibility.LockedBody() }

// IsPrivate —— convenience for Visibility().IsPrivate().
func (w *Writing) IsPrivate() bool { return w.visibility.IsPrivate() }

// --- Constants (re-exported for callers; the sub-object's constants remain the
// single source) ---

// WritingVisibilityPublic / WritingVisibilityPrivate —— constant names kept for
// compatibility with existing caller usage. Underlying values always flow
// through VisibilityPublic / VisibilityPrivate (visibility.go).
const (
	WritingVisibilityPublic  = VisibilityPublic
	WritingVisibilityPrivate = VisibilityPrivate
)

// WritingCoverHueAmber / Violet / Acid —— same kind of compatibility constants.
const (
	WritingCoverHueAmber  = CoverHueAmber
	WritingCoverHueViolet = CoverHueViolet
	WritingCoverHueAcid   = CoverHueAcid
)

// ErrWritingNotFound —— the writing id / slug doesn't exist or doesn't belong to
// this owner.
var ErrWritingNotFound = errors.New("writing not found")

// ErrWritingSlugTaken —— slug collision within the same owner (unique constraint).
var ErrWritingSlugTaken = errors.New("writing slug already taken in this owner")
