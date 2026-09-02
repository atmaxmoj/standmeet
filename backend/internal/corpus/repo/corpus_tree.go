// corpus_tree.go —— one lazy-load layer of the admin corpus tree (owner-scoped, all
// statuses). Each call fetches only the direct children of one parent node, paired with
// has_children (whether it can still be drilled into) and path_titles (the root→leaf title
// chain, slugified at the route layer into the "view live" address). This keeps the admin
// tree scale-safe on a large corpus: it never pulls the whole tree at once.
// The public-side ListNoteChildren is label-only + ACL; this one is the owner's full set +
// rich rows (body/tags/excerpt).

package repo

import (
	"context"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/corpus/db"
	"github.com/atmaxmoj/standmeet/internal/corpus/entity"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// TreeChild —— one lazy-tree layer node: the full domain entry + its root→leaf title
// chain (slugified into the address at the route layer) + whether it can be drilled
// into. Generic over the genre's domain type.
type TreeChild[T any] struct {
	Entry       T
	PathTitles  []string
	HasChildren bool
}

// childrenReq —— fetch args for one owner-scoped tree level (kept as a struct to stay
// under the arg-count limit; genre is the caller's constant).
type childrenReq struct {
	pool     *pgstore.Pool
	parentID *string
	ownerID  string
	genre    string
}

// adminChildren —— shared body: fetch one owner-scoped level for a genre and map each
// row's embedded note to its domain type. Reuses the generic listChildrenMeta plumbing.
func adminChildren[T any](
	ctx context.Context, req childrenReq, toDomain func(*db.CorpusNote) T,
) ([]TreeChild[T], error) {
	return listChildrenMeta(req.ownerID, req.parentID,
		func(o, p pgtype.UUID) ([]db.ListNoteChildrenAdminRow, error) {
			return db.New(req.pool).ListNoteChildrenAdmin(ctx, db.ListNoteChildrenAdminParams{
				OwnerID: o, Genre: req.genre, Column3: p,
			})
		},
		func(row db.ListNoteChildrenAdminRow) TreeChild[T] {
			return TreeChild[T]{
				Entry:       toDomain(&row.CorpusNote),
				HasChildren: row.HasChildren,
				PathTitles:  row.PathTitles,
			}
		})
}

// ListChildrenTree —— one lazy layer of the wiki tree (owner-scoped, all statuses).
func (r *WikiRepo) ListChildrenTree(
	ctx context.Context, ownerID string, parentID *string,
) ([]TreeChild[entity.Wiki], error) {
	return adminChildren(ctx, childrenReq{r.pool, parentID, ownerID, genreWiki}, toDomainWiki)
}

// ListChildrenTree —— one lazy layer of the output tree.
func (r *OutputRepo) ListChildrenTree(
	ctx context.Context, ownerID string, parentID *string,
) ([]TreeChild[entity.Output], error) {
	return adminChildren(ctx, childrenReq{r.pool, parentID, ownerID, genreOutput}, toDomainOutput)
}

// ListChildrenTree —— one lazy layer of the raw inbox tree.
func (r *RawRepo) ListChildrenTree(
	ctx context.Context, ownerID string, parentID *string,
) ([]TreeChild[entity.Raw], error) {
	return adminChildren(ctx, childrenReq{r.pool, parentID, ownerID, genreRaw}, toDomainRaw)
}

// ListChildrenTree —— one lazy layer of a NoteRepo's tree (r.genre, so subjectivity gets one too).
// subjectivity previously had no tree — the owner couldn't see the genre the CV lives in from
// admin at all, let alone toggle its access from the tree (F-A-15). This isn't subjectivity-
// specific: NoteRepo was already genre-parameterized.
func (r *NoteRepo) ListChildrenTree(
	ctx context.Context, ownerID string, parentID *string,
) ([]TreeChild[Note], error) {
	return adminChildren(ctx, childrenReq{r.pool, parentID, ownerID, r.genre}, noteFromRow)
}

// ListChildrenTree —— one lazy layer of the writings tree (genre='writing' corpus_notes).
func (r *WritingRepo) ListChildrenTree(
	ctx context.Context, ownerID string, parentID *string,
) ([]TreeChild[entity.Writing], error) {
	return adminChildren(ctx, childrenReq{r.pool, parentID, ownerID, genreWriting}, toDomainWriting)
}
