// document.go —— the unified abstraction over a single corpus element. raw / wiki /
// output / writing are each a Genre (a distinct partition) of Document, addressed by URI.
//
// Design motivation: the visitor chat retriever currently writes one symmetric block of
// code per Genre (the find / match / row triad, each N-way). Once Document lands, the
// retriever core moves to []Document, converging the multi-Genre code into one
// path-dispatch.
//
// **Phase A.2 is purely additive** — no existing type/method gets removed; only the 4
// concrete corpus types are made to implement Document, so existing callers keep working.
// A.3-IAM is where the retriever core actually switches over.

package entity

import (
	"errors"
	"time"

	"github.com/atmaxmoj/standmeet/internal/connector"
)

// ErrSubjectivityNotFound —— a subjectivity lookup by id came up empty (used by the
// dialog's cited-source reverse lookup).
var ErrSubjectivityNotFound = errors.New("subjectivity entry not found")

// DocumentGenre —— the enum of the corpus's 4 partitions. The name **Genre** is taken
// from standard IR/library-science vocabulary, expressing "a peer subset of the corpus
// with a distinct form/purpose" — distinct from words like layer/stage/tier that imply
// hierarchy.
type DocumentGenre string

// Genre enum values —— the literal doubles as the URI scheme, shared across
// serialization / DB column / frontend string, so there's no separate set of constants
// to keep in sync.
const (
	GenreRaw     DocumentGenre = "raw"
	GenreWiki    DocumentGenre = "wiki"
	GenreOutput  DocumentGenre = "output"
	GenreWriting DocumentGenre = "writing"
	// GenreSubjectivity —— the owner's private self-model partition. The agent retrieves it
	// to ground voice, but it's not cited by default (never shown in the visitor footer);
	// only notes with show_as_source=true surface, via cited_subjectivity_ids. Deliberately
	// left out of AllGenres: the Corpus facade's 4-genre List/Get dispatch doesn't cover
	// subjectivity.
	GenreSubjectivity DocumentGenre = "subjectivity"
)

// AllGenres —— use this whenever a caller needs to iterate the 4 genres, so hardcoded
// lists don't get scattered around.
var AllGenres = []DocumentGenre{
	GenreRaw, GenreWiki, GenreOutput, GenreWriting,
}

// Document —— the interface over a single corpus element.
//
// The 4 concrete types (Raw / Wiki / Output / Writing) implement this interface
// (A.2-Encap already satisfies the full method set). The interface is deliberately kept
// small, exposing only the fields the retriever / ACL / list code actually uses;
// Genre-specific fields like hue / cover / excerpt don't join the interface — callers
// that need them type-assert back to the concrete type.
type Document interface {
	// ID —— the backing database uuid. Persisted relations like messages.cited_*_ids rely
	// on it; the retriever / dialog write message references uniformly via Document.ID().
	ID() string

	// URI —— the `<genre>://<addressable>` shape, the unique addressing key across the
	// whole corpus.
	URI() string

	// Genre —— returns the owning partition. Equivalent info can be parsed out of the
	// URI, but the interface exposes it directly so callers don't all have to ParseURI.
	Genre() DocumentGenre

	// OwnerID —— corpus is always owner-scoped. A multi-tenant freebie.
	OwnerID() string

	// Title —— the display name. Shared by retriever indexing, list rendering, and
	// cross-link resolution. Raw always returns "" (contract boundary).
	Title() string

	// Body —— the main text. What the retriever's read returns; the bag-of-words index is
	// built on this via StripMarkdown. Each Genre's internal field name differs (they're
	// all backed by this content sub-object's content.body).
	Body() string

	// Tags —— also tokenized for retriever matching, and shown in list rendering. Always
	// returns a non-nil slice (defensive copy).
	Tags() []string

	// CreatedAt / UpdatedAt —— consistent across Genres, used by list / sort / "recently
	// changed" style queries. Raw.UpdatedAt() == Raw.CreatedAt() (contract boundary: Raw
	// is immutable post-dump).
	CreatedAt() time.Time
	UpdatedAt() time.Time

	// Integrations —— the list of this document's sync relationships with external
	// systems (Obsidian / Notion / etc). Always returns a non-nil slice.
	Integrations() []connector.Integration
}
