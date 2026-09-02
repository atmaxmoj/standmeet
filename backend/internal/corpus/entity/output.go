// output.go —— the most refined layer. raw → wiki → output. Output is structurally
// identical to Wiki (tree-shaped + SEO fields); the semantic difference is "a finished
// piece that can be quoted whole, verbatim, in conversation."
//
// LSP contract (shared across the 4 Genres):
//   - Output.Title() is non-empty
//   - Output.IsPublished() is always true (same as Wiki: existing means visible)
//   - other methods follow the general Document contract
//
// Output-specific fields: ParentID / Path / ShowAsSource / Excerpt / Published /
// SourceWikiIDs —— the only structural difference between Output and Wiki is
// SourceWikiIDs vs SourceRawIDs; everything else is symmetric.

package entity

import (
	"errors"
	"slices"
	"time"

	"github.com/atmaxmoj/standmeet/internal/connector"
)

// Output —— the domain value object for a corpus_notes row with genre=output. Its
// structure lines up exactly with Wiki, differing only in SourceWikiIDs vs SourceRawIDs
// (kept semantically distinct). Retrieval ACL + landing reuse the same Path / ShowAsSource
// fields — same as wiki.
type Output struct {
	timestamps    Timestamps
	tree          TreeNode
	id            string
	ownerID       string
	title         string
	content       Content
	integrations  connector.Integrations
	excerpt       string
	sourceWikiIDs []string
	showAsSource  bool
	published     bool
}

// OutputInit —— constructor params.
type OutputInit struct {
	UpdatedAt     time.Time
	CreatedAt     time.Time
	ParentID      *string
	Title         string
	ID            string
	OwnerID       string
	Body          string
	Excerpt       string
	SourceWikiIDs []string
	Tags          []string
	Integrations  connector.Integrations
	Published     bool
	ShowAsSource  bool
}

// NewOutput —— builds from Init. Pointer param sidesteps the hugeParam lint.
func NewOutput(i *OutputInit) Output {
	srcs := []string{}
	if len(i.SourceWikiIDs) > 0 {
		srcs = slices.Clone(i.SourceWikiIDs)
	}
	return Output{
		id:            i.ID,
		ownerID:       i.OwnerID,
		title:         i.Title,
		showAsSource:  i.ShowAsSource,
		sourceWikiIDs: srcs,
		content: NewContent(&ContentInit{
			Title: i.Title, Body: i.Body, Tags: i.Tags,
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

// URI —— output://<id>. The address tree is derived and shifts with the collection;
// cite/addressing goes by the stable id instead.
func (o *Output) URI() string {
	return FormatURI(GenreOutput, o.id)
}

// Genre —— always returns GenreOutput.
func (*Output) Genre() DocumentGenre { return GenreOutput }

// ID —— the DB primary key.
func (o *Output) ID() string { return o.id }

// OwnerID —— the owner-scoped corpus FK.
func (o *Output) OwnerID() string { return o.ownerID }

// Title —— the output entry's title.
func (o *Output) Title() string { return o.content.Title() }

// Body —— the output entry's main text.
func (o *Output) Body() string { return o.content.Body() }

// Tags —— the tag list (defensive copy).
func (o *Output) Tags() []string { return o.content.Tags() }

// CreatedAt —— creation time.
func (o *Output) CreatedAt() time.Time { return o.timestamps.CreatedAt() }

// UpdatedAt —— last-updated time.
func (o *Output) UpdatedAt() time.Time { return o.timestamps.UpdatedAt() }

// Integrations —— the attached integration list (defensive copy).
func (o *Output) Integrations() []connector.Integration { return o.integrations.All() }

// --- Output-specific accessors ---

// ParentID —— the parent output id, or ("", false) meaning root. Address-tree derived
// (see wiki).
func (o *Output) ParentID() (string, bool) { return o.tree.ParentID() }

// ShowAsSource —— whether this enters the readCollector's cited list.
func (o *Output) ShowAsSource() bool { return o.showAsSource }

// Excerpt —— a one-sentence summary (shared by the card excerpt / og:description / cited
// summary).
func (o *Output) Excerpt() string { return o.excerpt }

// Published —— whether this is public (enters the sitemap + robots index + is
// visitor-readable).
func (o *Output) Published() bool { return o.published }

// SourceWikiIDs —— which wikis this output was refined from (defensive copy).
func (o *Output) SourceWikiIDs() []string {
	return slices.Clone(o.sourceWikiIDs)
}

// ErrOutputNotFound —— an output lookup by id came up empty.
var ErrOutputNotFound = errors.New("output entry not found")
