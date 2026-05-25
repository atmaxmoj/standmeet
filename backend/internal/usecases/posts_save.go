// posts_save.go —— transactional post create / update / delete with assets。
//
// 入口：admin POST/PATCH /api/admin/posts 接 multipart (post JSON + 内联
// image files keyed by client-side pending UUID)。route layer 解 multipart
// 出 SavePostInput → 这里开 pgx tx → upload + insert assets + insert/update
// post → 失败回滚 + 反向删 MinIO blob。
//
// 删 post 同样事务：先列 + DELETE FROM assets WHERE holder_id = post.id，
// commit 后 best-effort 批删 MinIO blob。

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

// saveTxResult —— runSaveInTx 内部返回，避开 funcresult-limit 3。
type saveTxResult struct {
	Uploaded []string
	Post     domain.Post
}

// SavePost —— 单一 entry 同时处理 create 和 update。整个流程在一个 pgx
// tx 里：upload + asset 行 insert + post 行 insert/update 全成或全 rollback。
// rollback 后反向删已上传的 MinIO blob (best-effort)。
func SavePost(ctx context.Context, deps PostsTxDeps, in *SavePostInput) (domain.Post, error) {
	if verr := validateSaveInput(in); verr != nil {
		return domain.Post{}, verr
	}
	tx, err := deps.Posts.Pool().Begin(ctx)
	if err != nil {
		return domain.Post{}, fmt.Errorf("begin tx: %w", err)
	}
	res, serr := runSaveInTx(ctx, deps, tx, in)
	return finalizeSaveTx(ctx, deps, tx, &res, serr)
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

func runSaveInTx(
	ctx context.Context, deps PostsTxDeps, tx pgx.Tx, in *SavePostInput,
) (saveTxResult, error) {
	post, perr := upsertPostShell(ctx, deps, tx, in)
	if perr != nil {
		return saveTxResult{}, perr
	}
	up, uerr := uploadFilesAndBuildMap(ctx, deps, tx, post.ID, in.Files)
	if uerr != nil {
		return saveTxResult{Uploaded: up.Uploaded}, uerr
	}
	finalPost, werr := writePostBody(ctx, &writeBodyArgs{
		Deps: deps, Tx: tx, Post: &post, In: in, Rewrite: up.Rewrite,
	})
	return saveTxResult{Post: finalPost, Uploaded: up.Uploaded}, werr
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

// uploadResult —— uploadFilesAndBuildMap 的多返回打包，避开 funcresult-limit。
type uploadResult struct {
	Rewrite  map[string]string
	Uploaded []string
}

// uploadCtx —— uploadOneAndMap 参数打包（避开 argument-limit 5）。
type uploadCtx struct {
	Deps   PostsTxDeps
	Tx     pgx.Tx
	File   *FileInput
	Res    *uploadResult
	PostID string
}

// uploadFilesAndBuildMap —— 上传每个 file → 拿真 asset.id，build pending→real
// 替换 map。Uploaded 是已传 storage_key 列表，给 caller 在 rollback 时反向
// 删。
func uploadFilesAndBuildMap(
	ctx context.Context, deps PostsTxDeps, tx pgx.Tx,
	postID string, files []FileInput,
) (uploadResult, error) {
	res := uploadResult{
		Uploaded: make([]string, 0, len(files)),
		Rewrite:  make(map[string]string, len(files)),
	}
	for i := range files {
		if err := uploadOneAndMap(ctx, &uploadCtx{
			Deps: deps, Tx: tx, PostID: postID, File: &files[i], Res: &res,
		}); err != nil {
			return res, err
		}
	}
	return res, nil
}

func uploadOneAndMap(ctx context.Context, uc *uploadCtx) error {
	r, err := UploadInTx(ctx, uc.Deps.Assets, uc.Tx, uc.PostID, &AssetUploadInput{
		Body: uc.File.Body, ContentType: uc.File.ContentType,
		OriginalFilename: uc.File.OriginalFilename,
	})
	if err != nil {
		return fmt.Errorf("upload %s: %w", uc.File.PendingID, err)
	}
	uc.Res.Uploaded = append(uc.Res.Uploaded, r.StorageKey)
	uc.Res.Rewrite[uc.File.PendingID] = r.Asset.ID
	return nil
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

func finalizeSaveTx(
	ctx context.Context, deps PostsTxDeps, tx pgx.Tx,
	res *saveTxResult, err error,
) (domain.Post, error) {
	if err != nil {
		if rerr := tx.Rollback(ctx); rerr != nil {
			_ = rerr
		}
		DeleteBlobs(ctx, deps.Assets, res.Uploaded)
		return domain.Post{}, err
	}
	if cerr := tx.Commit(ctx); cerr != nil {
		DeleteBlobs(ctx, deps.Assets, res.Uploaded)
		return domain.Post{}, fmt.Errorf("commit save post: %w", cerr)
	}
	return res.Post, nil
}

// DeletePostWithAssets —— 物理删 post + 它名下所有 assets 行；commit 后批
// 删 MinIO blob (best-effort，失败 log；dead blob 无业务影响)。
func DeletePostWithAssets(
	ctx context.Context, deps PostsTxDeps, ownerID, postID string,
) error {
	if ownerID == "" || postID == "" {
		return ErrEmptyField
	}
	tx, err := deps.Posts.Pool().Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	keys, derr := runDeleteInTx(ctx, deps, tx, ownerID, postID)
	return finalizeDeleteTx(ctx, deps, tx, keys, derr)
}

func runDeleteInTx(
	ctx context.Context, deps PostsTxDeps, tx pgx.Tx, ownerID, postID string,
) ([]string, error) {
	keys, kerr := deps.Assets.Repo.DeleteByHolderTx(ctx, tx, postID)
	if kerr != nil {
		return nil, fmt.Errorf("delete assets: %w", kerr)
	}
	if perr := deps.Posts.DeleteTx(ctx, tx, ownerID, postID); perr != nil {
		return keys, fmt.Errorf("delete post: %w", perr)
	}
	return keys, nil
}

func finalizeDeleteTx(
	ctx context.Context, deps PostsTxDeps, tx pgx.Tx, keys []string, err error,
) error {
	if err != nil {
		if rerr := tx.Rollback(ctx); rerr != nil {
			_ = rerr
		}
		return err
	}
	if cerr := tx.Commit(ctx); cerr != nil {
		return fmt.Errorf("commit delete post: %w", cerr)
	}
	DeleteBlobs(ctx, deps.Assets, keys)
	return nil
}
