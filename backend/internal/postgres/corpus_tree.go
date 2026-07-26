// corpus_tree.go —— admin 语料树的懒加载一层（owner-scoped，全状态）。每次只取某个
// 父节点的直接子，配 has_children 决定还能否下钻 + path_titles（root→leaf 标题链，路由层
// slug 成 "view live" 地址）。这让 admin 树在大 corpus 下 scale-safe：永不一次性拉全树。
// 公开侧的 ListNoteChildren 是 label-only + ACL；这里是 owner 全量 + 富行（body/tags/excerpt）。

package postgres

import (
	"context"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/corpusdomain"
	"github.com/atmaxmoj/standmeet/internal/postgres/dbq"
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
	pool     *Pool
	parentID *string
	ownerID  string
	genre    string
}

// adminChildren —— shared body: fetch one owner-scoped level for a genre and map each
// row's embedded note to its domain type. Reuses the generic listChildrenMeta plumbing.
func adminChildren[T any](
	ctx context.Context, req childrenReq, toDomain func(*dbq.CorpusNote) T,
) ([]TreeChild[T], error) {
	return listChildrenMeta(req.ownerID, req.parentID,
		func(o, p pgtype.UUID) ([]dbq.ListNoteChildrenAdminRow, error) {
			return dbq.New(req.pool).ListNoteChildrenAdmin(ctx, dbq.ListNoteChildrenAdminParams{
				OwnerID: o, Genre: req.genre, Column3: p,
			})
		},
		func(row dbq.ListNoteChildrenAdminRow) TreeChild[T] {
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
) ([]TreeChild[corpusdomain.Wiki], error) {
	return adminChildren(ctx, childrenReq{r.pool, parentID, ownerID, genreWiki}, toDomainWiki)
}

// ListChildrenTree —— one lazy layer of the output tree.
func (r *OutputRepo) ListChildrenTree(
	ctx context.Context, ownerID string, parentID *string,
) ([]TreeChild[corpusdomain.Output], error) {
	return adminChildren(ctx, childrenReq{r.pool, parentID, ownerID, genreOutput}, toDomainOutput)
}

// ListChildrenTree —— one lazy layer of the raw inbox tree.
func (r *RawRepo) ListChildrenTree(
	ctx context.Context, ownerID string, parentID *string,
) ([]TreeChild[corpusdomain.Raw], error) {
	return adminChildren(ctx, childrenReq{r.pool, parentID, ownerID, genreRaw}, toDomainRaw)
}

// ListChildrenTree —— one lazy layer of a NoteRepo's tree (r.genre, so subjectivity gets one too).
// subjectivity 之前没有 tree —— owner 在 admin 里根本看不见 CV 所在的那个 genre,更没法从树上勾它
// 的准入(F-A-15)。这里不是 subjectivity 专用:NoteRepo 本来就是 genre-参数化的。
func (r *NoteRepo) ListChildrenTree(
	ctx context.Context, ownerID string, parentID *string,
) ([]TreeChild[Note], error) {
	return adminChildren(ctx, childrenReq{r.pool, parentID, ownerID, r.genre}, noteFromRow)
}

// ListChildrenTree —— one lazy layer of the writings tree (genre='writing' corpus_notes).
func (r *WritingRepo) ListChildrenTree(
	ctx context.Context, ownerID string, parentID *string,
) ([]TreeChild[corpusdomain.Writing], error) {
	return adminChildren(ctx, childrenReq{r.pool, parentID, ownerID, genreWriting}, toDomainWriting)
}
