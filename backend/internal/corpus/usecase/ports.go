// ports.go —— the read ports the corpus module exposes externally (consumers code
// against these narrow interfaces; prod's *WikiRepo/*OutputRepo/*WritingRepo satisfy
// them structurally; the eval in-memory fixture fills them in too). Extracted out of
// usecases/visitor_data_sources.go so the corpus usecase and visitor orchestration
// share it.

package usecase

import (
	"context"

	"github.com/atmaxmoj/standmeet/internal/corpus/entity"
	"github.com/atmaxmoj/standmeet/internal/corpus/repo"
)

// WikiLister —— owner-scoped wiki corpus for retrieval. The in-memory window
// ListByOwner plus a trio of DB lazy-loads: full-text search (Search), read meta by id
// (GetMetaByID, walks up parents to compute path), read body by id (GetByID). prod's
// *WikiRepo satisfies this as-is; the eval-harness in-memory fixture needs to fill in
// these three.
type WikiLister interface {
	ListByOwner(ctx context.Context, ownerID string, limit int32) ([]entity.Wiki, error)
	Search(
		ctx context.Context, ownerID, query string, limit, offset int32,
	) ([]repo.WikiMeta, error)
	ListChildren(
		ctx context.Context, ownerID string, parentID *string, limit, offset int32,
	) ([]repo.WikiMeta, error)
	GetMetaByID(ctx context.Context, ownerID, id string) (repo.WikiMeta, error)
	GetByID(ctx context.Context, ownerID, id string) (entity.Wiki, error)
}

// OutputLister —— owner-scoped output corpus for retrieval. Wiki's twin: on top of the
// in-memory window ListByOwner, adds DB lazy-loads: full-text search (Search), read meta
// by id (GetMetaByID, walks up parents to compute path), read body by id (GetByID).
// prod's *OutputRepo satisfies this as-is.
type OutputLister interface {
	ListByOwner(ctx context.Context, ownerID string, limit int32) ([]entity.Output, error)
	Search(
		ctx context.Context, ownerID, query string, limit, offset int32,
	) ([]repo.OutputMeta, error)
	ListChildren(
		ctx context.Context, ownerID string, parentID *string, limit, offset int32,
	) ([]repo.OutputMeta, error)
	GetMetaByID(ctx context.Context, ownerID, id string) (repo.OutputMeta, error)
	GetByID(ctx context.Context, ownerID, id string) (entity.Output, error)
}

// WritingLister —— owner-scoped published writings for retrieval. The third twin of
// wiki/output: DB full-text search (Search) + read by tree-derived path
// (GetPublishedByPath), bypassing the in-memory window entirely. (A writing is admitted
// by its published flag and carries its own path column, so no tree walk-up is needed.)
// corpus_list still uses ListPublishedByOwner's in-memory list (a flat genre, same as
// output).
type WritingLister interface {
	ListPublishedByOwner(ctx context.Context, ownerID string) ([]entity.Writing, error)
	Search(
		ctx context.Context, ownerID, query string, limit, offset int32,
	) ([]entity.Writing, error)
	GetPublishedByPath(ctx context.Context, ownerID, path string) (entity.Writing, error)
}
