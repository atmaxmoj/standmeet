// posts_save.go —— transactional post create / update / delete with assets。
//
// 入口：admin POST/PATCH /api/admin/posts 接 multipart (post JSON + 内联
// image files keyed by client-side pending UUID)。route layer 解 multipart
// 出 SavePostInput → 这里：
//
//   CREATE / UPDATE:
//     1. tx：insert post shell + insert asset 行（uuid 预生成，storage_key
//        已确定，但 MinIO 还没 PUT）+ update post body_md（替 pending-id → 真 uuid）
//     2. tx commit
//     3. tx commit 之后才 UploadBlobs 把 bytes 真推 MinIO
//     4. UploadBlobs 失败 → compensating DeletePostWithAssets 把 post 卷掉
//        + best-effort 删那部分已上传 blob
//
//   DELETE:
//     1. List storage_keys（无 tx）
//     2. DeleteBlobsStrict MinIO（任一失败立刻 abort，DB 不动）
//     3. tx：DELETE asset 行 + DELETE post 行 → commit
//
// invariant: blob 生命周期 ⊆ post 生命周期。
// 任何时刻 MinIO 有 blob ⇒ DB 必有对应 post + asset 行。
// 失败模式从"silent MinIO orphan"换成"visible broken post" 或 "owner
// retry-able delete"。

package usecases

import (
	"context"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/postgres"
)

// FileInput —— 一张上传的图。PendingID 是前端 editor 分配的 client-side
// UUID，body_md / cover_image_ref 里写 `pending-<id>`（注意是不带前缀
// `standmeet-asset:` 的 raw id，body_md 里写完整 `standmeet-asset:pending-<id>`）。
type FileInput struct {
	PendingID        string
	ContentType      string
	OriginalFilename string
	Body             []byte
}

// SavePostInput —— create + update 共用。PostID 空 = create，非空 = update。
// CoverImageRef 可以是 pending-<id> 占位（新上传），或已存在 asset 的真
// UUID（edit 时未改 cover），或空（无 cover）。fieldalignment: slice 24B
// 先，string 16B 后，bool 1B 最后。
type SavePostInput struct {
	BodyMD        string
	CoverImageRef string
	LockedBody    string
	OwnerID       string
	PostID        string
	Slug          string
	Visibility    string
	Title         string
	CoverHue      string
	Excerpt       string
	CoverHeadline string
	CoverSub      string
	Tags          []string
	CrossRefs     []string
	Files         []FileInput
	Publish       bool
}

// saveCommitted —— runSaveInTx / saveInTxAndCommit 共用返回。Prepared 是
// 已 insert 的 asset 行 + 待上传 bytes，tx commit 之后由 UploadBlobs 推上
// MinIO。fieldalignment: slice 先，struct 后。
type saveCommitted struct {
	Prepared []PreparedAsset
	Post     domain.Post
}

// SavePost —— 单一 entry 同时处理 create 和 update。
//
// 顺序：tx (insert post + insert asset 行 + update body_md) → commit →
// UploadBlobs。上传失败做 compensating DeletePostWithAssets 把 post 卷掉。
func SavePost(ctx context.Context, deps PostsTxDeps, in *SavePostInput) (domain.Post, error) {
	if verr := validateSaveInput(in); verr != nil {
		return domain.Post{}, verr
	}
	committed, terr := saveInTxAndCommit(ctx, deps, in)
	if terr != nil {
		return domain.Post{}, terr
	}
	if err := uploadAndCompensate(ctx, deps, in.OwnerID, &committed); err != nil {
		return domain.Post{}, err
	}
	return committed.Post, nil
}

// validateSaveInput —— create + update 共用一个 entry，但 slug 只在 create
// 路径上从 input 取（edit UI slug readonly，client 不再 send）；update 时
// loadExistingPost 把 slug 从 DB 读出，input.Slug 此时为空是合法的。
func validateSaveInput(in *SavePostInput) error {
	if in.OwnerID == "" || in.Title == "" {
		return ErrEmptyField
	}
	if in.PostID == "" && in.Slug == "" {
		return ErrEmptyField
	}
	return nil
}

// saveInTxAndCommit —— 开 tx → 写 post + 写 asset 行 + 写 body_md → commit。
// 不动 MinIO。返回 commit 之后待上传的 prepared bytes。
func saveInTxAndCommit(
	ctx context.Context, deps PostsTxDeps, in *SavePostInput,
) (saveCommitted, error) {
	tx, err := deps.Posts.Pool().Begin(ctx)
	if err != nil {
		return saveCommitted{}, fmt.Errorf("begin tx: %w", err)
	}
	res, serr := runSaveInTx(ctx, deps, tx, in)
	if serr != nil {
		if rerr := tx.Rollback(ctx); rerr != nil {
			_ = rerr
		}
		return saveCommitted{}, serr
	}
	if cerr := tx.Commit(ctx); cerr != nil {
		return saveCommitted{}, fmt.Errorf("commit save post: %w", cerr)
	}
	return res, nil
}

// uploadAndCompensate —— tx commit 之后真把 bytes PUT 到 MinIO。任一失败
// 做 compensating delete：先反删那部分已传 blob (best-effort)，再 cascade
// 删 post + 所有 asset 行。
func uploadAndCompensate(
	ctx context.Context, deps PostsTxDeps, ownerID string, c *saveCommitted,
) error {
	done, uerr := UploadBlobs(ctx, deps.Assets, c.Prepared)
	if uerr == nil {
		return nil
	}
	DeleteBlobs(ctx, deps.Assets, done)
	if derr := DeletePostWithAssets(ctx, deps, ownerID, c.Post.ID); derr != nil {
		_ = derr
	}
	return fmt.Errorf("upload blobs: %w", uerr)
}

func runSaveInTx(
	ctx context.Context, deps PostsTxDeps, tx pgx.Tx, in *SavePostInput,
) (saveCommitted, error) {
	post, perr := upsertPostShell(ctx, deps, tx, in)
	if perr != nil {
		return saveCommitted{}, perr
	}
	prepared, ierr := insertAssetsForPost(ctx, deps, tx, post.ID, in.Files)
	if ierr != nil {
		return saveCommitted{}, ierr
	}
	finalPost, werr := writePostBody(ctx, &writeBodyArgs{
		Deps: deps, Tx: tx, Post: &post, In: in, Rewrite: rewriteFromPrepared(prepared),
	})
	return saveCommitted{Post: finalPost, Prepared: prepared}, werr
}

// rewriteFromPrepared —— 从 PreparedAsset 列表 build pending-id → real-id
// 替换 map（PendingID 字段已经在 InsertAssetRowTx 透传进来了）。
func rewriteFromPrepared(prepared []PreparedAsset) map[string]string {
	rewrite := make(map[string]string, len(prepared))
	for i := range prepared {
		rewrite[prepared[i].PendingID] = prepared[i].Asset.ID
	}
	return rewrite
}

// upsertPostShell —— 第一步：insert/update post 行（body_md 还带 pending
// 占位，cover_image_asset_id 设 NULL）。这步只是为了拿到 post.id 让后面
// 的 assets 行能挂 holder_id；body_md / cover 真正写在 writePostBody。
func upsertPostShell(
	ctx context.Context, deps PostsTxDeps, tx pgx.Tx, in *SavePostInput,
) (domain.Post, error) {
	if in.PostID == "" {
		p, err := deps.Posts.CreateTx(ctx, tx, buildShellCreateInput(in))
		if err != nil {
			return domain.Post{}, fmt.Errorf("create post: %w", err)
		}
		return p, nil
	}
	return loadExistingPost(ctx, deps, in)
}

func buildShellCreateInput(in *SavePostInput) *postgres.CreatePostInput {
	path := "posts/" + in.Slug
	return &postgres.CreatePostInput{
		OwnerID: in.OwnerID, Slug: in.Slug, Title: in.Title, Excerpt: in.Excerpt,
		BodyMD: "", CoverHeadline: in.CoverHeadline, CoverSub: in.CoverSub,
		CoverHue: in.CoverHue, CoverImageAssetID: nil,
		Tags: in.Tags, Visibility: in.Visibility, CrossRefs: in.CrossRefs,
		Path: path, ReadMinutes: 0, LockedBody: in.LockedBody, Publish: in.Publish,
	}
}

func loadExistingPost(
	ctx context.Context, deps PostsTxDeps, in *SavePostInput,
) (domain.Post, error) {
	p, err := deps.Posts.GetByID(ctx, in.OwnerID, in.PostID)
	if err != nil {
		return domain.Post{}, fmt.Errorf("load existing post: %w", err)
	}
	return p, nil
}

// insertAssetsForPost —— tx 里 insert 每张 asset 行（不动 MinIO）。
// PendingID 透传进 PreparedAsset，caller (writePostBody) 用 rewriteFromPrepared
// 现做 rewrite map。
func insertAssetsForPost(
	ctx context.Context, deps PostsTxDeps, tx pgx.Tx,
	postID string, files []FileInput,
) ([]PreparedAsset, error) {
	prepared := make([]PreparedAsset, 0, len(files))
	for i := range files {
		f := &files[i]
		p, err := InsertAssetRowTx(ctx, deps.Assets, tx, postID, &AssetUploadInput{
			Body: f.Body, ContentType: f.ContentType,
			OriginalFilename: f.OriginalFilename, PendingID: f.PendingID,
		})
		if err != nil {
			return prepared, fmt.Errorf("insert asset %s: %w", f.PendingID, err)
		}
		prepared = append(prepared, p)
	}
	return prepared, nil
}

// writeBodyArgs —— writePostBody 参数包，避开 argument-limit 5。
type writeBodyArgs struct {
	Rewrite map[string]string
	Tx      pgx.Tx
	Post    *domain.Post
	In      *SavePostInput
	Deps    PostsTxDeps
}

// writePostBody —— 用 rewrite map 把 pending 占位换成真 asset id，写最终
// body_md + cover_image_asset_id。
func writePostBody(ctx context.Context, a *writeBodyArgs) (domain.Post, error) {
	body := rewriteRefs(a.In.BodyMD, a.Rewrite)
	cover := rewriteCoverRef(a.In.CoverImageRef, a.Rewrite)
	p, err := a.Deps.Posts.UpdateTx(ctx, a.Tx, &postgres.UpdatePostInput{
		OwnerID: a.In.OwnerID, PostID: a.Post.ID, Title: a.In.Title,
		Excerpt: a.In.Excerpt, BodyMD: body,
		CoverHeadline: a.In.CoverHeadline, CoverSub: a.In.CoverSub,
		CoverHue: a.In.CoverHue, CoverImageAssetID: cover,
		Tags: a.In.Tags, Visibility: a.In.Visibility, CrossRefs: a.In.CrossRefs,
		Path: a.Post.Path, ReadMinutes: estimateReadMinutes(body),
		LockedBody: a.In.LockedBody,
	})
	if err != nil {
		return domain.Post{}, fmt.Errorf("update post body: %w", err)
	}
	return p, nil
}

// rewriteRefs —— 替换 body_md 里 standmeet-asset:pending-<id> 为
// standmeet-asset:<real-id>。
func rewriteRefs(body string, rewrite map[string]string) string {
	for pendingID, realID := range rewrite {
		body = strings.ReplaceAll(body,
			AssetURIScheme+pendingID, AssetURIScheme+realID)
	}
	return body
}

func rewriteCoverRef(ref string, rewrite map[string]string) *string {
	if ref == "" {
		return nil
	}
	resolved := ref
	if realID, ok := rewrite[ref]; ok {
		resolved = realID
	}
	return &resolved
}

// DeletePostWithAssets 在 posts_delete.go。
