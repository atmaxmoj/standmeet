// wiki.go — curated content (tree-shaped) + owner-scoped global SEO settings.
//
// LSP contract (shared across all 4 Genres):
//   - Wiki.Title() is non-empty (title is required when an owner curates a wiki entry)
//   - Wiki.IsPublished() is always true (wiki has no draft concept — existing means visible)
//   - Other methods follow the usual convention: Tags / Integrations always return non-nil
//
// Wiki-specific fields: ParentID / Path / ShowAsSource / Excerpt /
// Published / SourceRawIDs — for callers that type-assert back to Wiki. Path/Parent
// go through the TreeNode sub-object; SEO goes through the SEO sub-object.

package entity

import (
	"errors"
	"slices"
	"time"

	"github.com/atmaxmoj/standmeet/internal/connector"
)

// Wiki — the domain value object for a corpus_notes row with genre=wiki.
//
// ShowAsSource: the AI inside the retriever can read the body, but readCollector
// won't collect it — this switch is for meta/persona-type entries that are
// "usable but shouldn't be exposed".
type Wiki struct {
	timestamps   Timestamps
	tree         TreeNode
	id           string
	ownerID      string
	title        string
	content      Content
	integrations connector.Integrations
	excerpt      string
	sourceRawIDs []string
	showAsSource bool
	published    bool
}

// WikiInit — constructor parameters.
type WikiInit struct {
	UpdatedAt    time.Time
	CreatedAt    time.Time
	ParentID     *string
	Title        string
	ID           string
	OwnerID      string
	Body         string
	Excerpt      string
	SourceRawIDs []string
	Tags         []string
	CSSClasses   []string
	Integrations connector.Integrations
	Published    bool
	ShowAsSource bool
}

// NewWiki — constructs from Init. SourceRawIDs is defensively cloned. Pointer param
// avoids hugeParam.
func NewWiki(i *WikiInit) Wiki {
	srcs := []string{}
	if len(i.SourceRawIDs) > 0 {
		srcs = slices.Clone(i.SourceRawIDs)
	}
	return Wiki{
		id:           i.ID,
		ownerID:      i.OwnerID,
		title:        i.Title,
		showAsSource: i.ShowAsSource,
		sourceRawIDs: srcs,
		content: NewContent(&ContentInit{
			Title: i.Title, Body: i.Body, Tags: i.Tags, CSSClasses: i.CSSClasses,
		}),
		timestamps: NewTimestamps(&TimestampsInit{
			CreatedAt: i.CreatedAt, UpdatedAt: i.UpdatedAt,
		}),
		tree:         NewTreeNode(&TreeNodeInit{ParentID: i.ParentID}),
		excerpt:      i.Excerpt,
		published:    i.Published,
		integrations: i.Integrations,
	}
}

// --- Document interface (flat forwarding) ---

// URI — wiki://<id>. The address (tree-derived path) is computed at retrieval time and
// varies with the collection — it's not the entry's own stable identity; citing/addressing
// always goes by the stable id.
func (w *Wiki) URI() string {
	return FormatURI(GenreWiki, w.id)
}

// Genre — always returns GenreWiki.
func (*Wiki) Genre() DocumentGenre { return GenreWiki }

// ID — DB primary key.
func (w *Wiki) ID() string { return w.id }

// OwnerID — owner-scoped corpus FK.
func (w *Wiki) OwnerID() string { return w.ownerID }

// Title — the wiki entry's title.
func (w *Wiki) Title() string { return w.content.Title() }

// Body — the wiki entry's main text.
func (w *Wiki) Body() string { return w.content.Body() }

// Tags — the tag list (defensive copy).
func (w *Wiki) Tags() []string { return w.content.Tags() }

// CSSClasses — per-note cssclasses (a presentation hook).
func (w *Wiki) CSSClasses() []string { return w.content.CSSClasses() }

// CreatedAt — creation time.
func (w *Wiki) CreatedAt() time.Time { return w.timestamps.CreatedAt() }

// UpdatedAt — last update time.
func (w *Wiki) UpdatedAt() time.Time { return w.timestamps.UpdatedAt() }

// Integrations — the attached integration list (defensive copy).
func (w *Wiki) Integrations() []connector.Integration { return w.integrations.All() }

// --- Wiki-specific accessors ---

// ParentID — the parent wiki id, or ("", false) meaning root. The address is derived
// from this parent-chain tree (usecases.WikiTreePaths); it's not stored on the entry itself.
func (w *Wiki) ParentID() (string, bool) { return w.tree.ParentID() }

// ShowAsSource — whether this enters readCollector's cited list (default true;
// persona-type entries set it false).
func (w *Wiki) ShowAsSource() bool { return w.showAsSource }

// Excerpt — a one-sentence summary (shared by the card excerpt / og:description /
// cited summary).
func (w *Wiki) Excerpt() string { return w.excerpt }

// Published — whether this is public (goes into sitemap + robots index + visitor-readable).
func (w *Wiki) Published() bool { return w.published }

// SourceRawIDs — which raw entries this wiki was promoted from (defensive copy).
func (w *Wiki) SourceRawIDs() []string {
	return slices.Clone(w.sourceRawIDs)
}

// SEOSettings — owner-scoped global SEO settings.
// Field order follows govet fieldalignment: time.Time first (internal ptr at 16), strings
// in the middle (ptr at 0), slice near the end (ptr at 0), bool last to take the tail padding.
type SEOSettings struct {
	UpdatedAt     time.Time
	OwnerID       string
	SiteTitle     string
	OGTemplate    string
	SitemapExtras []string
	IndexRobots   bool
}

// ErrWikiNotFound — looking up a wiki by id found nothing.
var ErrWikiNotFound = errors.New("wiki entry not found")

// ErrParentNotFound — the parent_id given at create/promote time can't be found under
// this owner (doesn't exist / belongs to another owner). Since the address is tree-derived
// and deletion cascades, attaching to an invalid parent (leaving an orphan) is disallowed.
var ErrParentNotFound = errors.New("parent entry not found")

// ErrParentCycle — when UpdateWiki changes the parent, attaching a node under itself or
// its own descendant would form a cycle (since the address is tree-derived, a cycle makes
// path computation meaningless). Rejected.
var ErrParentCycle = errors.New("parent would create a cycle")

// ErrSiblingSlugTaken — a sibling under the same parent (folder) already has the same
// title slug. Since address = tree-derived slug path, a same-slug sibling would break the
// path's 1:1 mapping (the second entry couldn't be addressed on its own). Obsidian semantics:
// a folder can't hold two files with the same name — reject at write time, no silent
// rename/merge.
var ErrSiblingSlugTaken = errors.New("a sibling entry with the same name already exists")
