// writings_save.go —— transactional writing create / update / delete with assets。
//
// 入口：admin POST/PATCH /api/admin/writings 接 multipart (writing JSON +
// 内联 image files keyed by client-side pending UUID)。route layer 解
// multipart 出 SaveWritingInput → 这里：
//
//   CREATE / UPDATE:
//     1. tx：insert writing shell + insert asset 行（uuid 预生成，storage_key
//        已确定，但 MinIO 还没 PUT）+ update writing body_md（替 pending-id → 真 uuid）
//     2. tx commit
//     3. tx commit 之后才 UploadBlobs 把 bytes 真推 MinIO
//     4. UploadBlobs 失败 → compensating DeleteWritingWithAssets 把 writing 卷掉
//        + best-effort 删那部分已上传 blob
//
//   DELETE:
//     1. List storage_keys（无 tx）
//     2. DeleteBlobsStrict MinIO（任一失败立刻 abort，DB 不动）
//     3. tx：DELETE asset 行 + DELETE writing 行 → commit
//
// invariant: blob 生命周期 ⊆ writing 生命周期。
// 任何时刻 MinIO 有 blob ⇒ DB 必有对应 writing + asset 行。
// 失败模式从"silent MinIO orphan"换成"visible broken writing" 或 "owner
// retry-able delete"。

package usecases

import (
	"context"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/postgres"
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

// SaveWritingInput —— create + update 共用。WritingID 空 = create，非空 = update。
// CoverImageRef 可以是 pending-<id> 占位（新上传），或已存在 asset 的真
// UUID（edit 时未改 cover），或空（无 cover）。
type SaveWritingInput struct {
	BodyMD        string
	CoverImageRef string
	LockedBody    string
	OwnerID       string
	WritingID     string
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
// MinIO。
type saveCommitted struct {
	Prepared []PreparedAsset
	Writing  domain.Writing
}

// SaveWriting —— 单一 entry 同时处理 create 和 update。
//
// 顺序：tx (insert writing + insert asset 行 + update body_md) → commit →
// UploadBlobs。上传失败做 compensating DeleteWritingWithAssets 把 writing 卷掉。
func SaveWriting(
	ctx context.Context, deps WritingsTxDeps, in *SaveWritingInput,
) (domain.Writing, error) {
	if verr := validateSaveInput(in); verr != nil {
		return domain.Writing{}, verr
	}
	committed, terr := saveInTxAndCommit(ctx, deps, in)
	if terr != nil {
		return domain.Writing{}, terr
	}
	if err := uploadAndCompensate(ctx, deps, in.OwnerID, &committed); err != nil {
		return domain.Writing{}, err
	}
	return committed.Writing, nil
}

// validateSaveInput —— create + update 共用一个 entry，但 slug 只在 create
// 路径上从 input 取（edit UI slug readonly，client 不再 send）；update 时
// loadExistingWriting 把 slug 从 DB 读出，input.Slug 此时为空是合法的。
func validateSaveInput(in *SaveWritingInput) error {
	if in.OwnerID == "" || in.Title == "" {
		return ErrEmptyField
	}
	if in.WritingID == "" && in.Slug == "" {
		return ErrEmptyField
	}
	return nil
}

// saveInTxAndCommit —— 开 tx → 写 writing + 写 asset 行 + 写 body_md → commit。
// 不动 MinIO。返回 commit 之后待上传的 prepared bytes。
func saveInTxAndCommit(
	ctx context.Context, deps WritingsTxDeps, in *SaveWritingInput,
) (saveCommitted, error) {
	tx, err := deps.Writings.Pool().Begin(ctx)
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
		return saveCommitted{}, fmt.Errorf("commit save writing: %w", cerr)
	}
	return res, nil
}

// uploadAndCompensate —— tx commit 之后真把 bytes PUT 到 MinIO。任一失败
// 做 compensating delete：先反删那部分已传 blob (best-effort)，再 cascade
// 删 writing + 所有 asset 行。
func uploadAndCompensate(
	ctx context.Context, deps WritingsTxDeps, ownerID string, c *saveCommitted,
) error {
	done, uerr := UploadBlobs(ctx, deps.Assets, c.Prepared)
	if uerr == nil {
		return nil
	}
	DeleteBlobs(ctx, deps.Assets, done)
	if derr := DeleteWritingWithAssets(ctx, deps, ownerID, c.Writing.ID()); derr != nil {
		_ = derr
	}
	return fmt.Errorf("upload blobs: %w", uerr)
}

func runSaveInTx(
	ctx context.Context, deps WritingsTxDeps, tx pgx.Tx, in *SaveWritingInput,
) (saveCommitted, error) {
	writing, perr := upsertWritingShell(ctx, deps, tx, in)
	if perr != nil {
		return saveCommitted{}, perr
	}
	prepared, ierr := insertAssetsForWriting(ctx, deps, tx, writing.ID(), in.Files)
	if ierr != nil {
		return saveCommitted{}, ierr
	}
	finalWriting, werr := writeWritingBody(ctx, &writeBodyArgs{
		Deps: deps, Tx: tx, Writing: &writing, In: in, Rewrite: rewriteFromPrepared(prepared),
	})
	if werr != nil {
		return saveCommitted{Writing: finalWriting, Prepared: prepared}, werr
	}
	if lerr := refreshCrossLinks(ctx, deps, tx, &finalWriting); lerr != nil {
		return saveCommitted{Writing: finalWriting, Prepared: prepared}, lerr
	}
	return saveCommitted{Writing: finalWriting, Prepared: prepared}, nil
}

// refreshCrossLinks —— 用 finalWriting.BodyMD（已经把 pending-asset / cover
// ref rewrite 完）抽 `[[X]]`，按 slug / title resolve 到其它 writing.id，重建
// writing_refs 表里这个 src 的出度。HasCrossLinks 短路避免没用到的 writing
// 也跑一遍 owner writings 列查询。
func refreshCrossLinks(
	ctx context.Context, deps WritingsTxDeps, tx pgx.Tx, writing *domain.Writing,
) error {
	writingID := writing.ID()
	writingOwner := writing.OwnerID()
	writingBody := writing.Body()
	if !HasCrossLinks(writingBody) {
		// body 没有 [[ ]] —— 仍要清掉之前可能存的边（owner 删了 link 也算）。
		if err := deps.WritingRefs.ReplaceRefsBySrcTx(
			ctx, tx, writingID, writingOwner, []string{},
		); err != nil {
			return fmt.Errorf("clear crosslinks: %w", err)
		}
		return nil
	}
	candidates, lerr := deps.Writings.ListByOwner(ctx, writingOwner)
	if lerr != nil {
		return fmt.Errorf("list owner writings for crosslink resolve: %w", lerr)
	}
	dstIDs := resolveAndDedupForOwner(writingBody, candidates)
	// 排除 self-link（src == dst）—— 没意义且让 backlink UI 显示自指。
	dstIDs = excludeSelf(dstIDs, writingID)
	if err := deps.WritingRefs.ReplaceRefsBySrcTx(
		ctx, tx, writingID, writingOwner, dstIDs,
	); err != nil {
		return fmt.Errorf("rewrite crosslinks: %w", err)
	}
	return nil
}

func excludeSelf(ids []string, selfID string) []string {
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		if id != selfID {
			out = append(out, id)
		}
	}
	return out
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

// upsertWritingShell —— 第一步：insert/update writing 行（body_md 还带 pending
// 占位，cover_image_asset_id 设 NULL）。这步只是为了拿到 writing.id 让后面
// 的 assets 行能挂 holder_id；body_md / cover 真正写在 writeWritingBody。
func upsertWritingShell(
	ctx context.Context, deps WritingsTxDeps, tx pgx.Tx, in *SaveWritingInput,
) (domain.Writing, error) {
	if in.WritingID == "" {
		p, err := deps.Writings.CreateTx(ctx, tx, buildShellCreateInput(in))
		if err != nil {
			return domain.Writing{}, fmt.Errorf("create writing: %w", err)
		}
		return p, nil
	}
	return loadExistingWriting(ctx, deps, in)
}

func buildShellCreateInput(in *SaveWritingInput) *postgres.CreateWritingInput {
	path := "writings/" + in.Slug
	return &postgres.CreateWritingInput{
		OwnerID: in.OwnerID, Slug: in.Slug, Title: in.Title, Excerpt: in.Excerpt,
		BodyMD: "", CoverHeadline: in.CoverHeadline, CoverSub: in.CoverSub,
		CoverHue: in.CoverHue, CoverImageAssetID: nil,
		Tags: in.Tags, Visibility: in.Visibility, CrossRefs: in.CrossRefs,
		Path: path, ReadMinutes: 0, LockedBody: in.LockedBody, Publish: in.Publish,
	}
}

func loadExistingWriting(
	ctx context.Context, deps WritingsTxDeps, in *SaveWritingInput,
) (domain.Writing, error) {
	p, err := deps.Writings.GetByID(ctx, in.OwnerID, in.WritingID)
	if err != nil {
		return domain.Writing{}, fmt.Errorf("load existing writing: %w", err)
	}
	return p, nil
}

// insertAssetsForWriting —— tx 里 insert 每张 asset 行（不动 MinIO）。
// PendingID 透传进 PreparedAsset，caller (writeWritingBody) 用
// rewriteFromPrepared 现做 rewrite map。
func insertAssetsForWriting(
	ctx context.Context, deps WritingsTxDeps, tx pgx.Tx,
	writingID string, files []FileInput,
) ([]PreparedAsset, error) {
	prepared := make([]PreparedAsset, 0, len(files))
	for i := range files {
		f := &files[i]
		p, err := InsertAssetRowTx(ctx, deps.Assets, tx, writingID, &AssetUploadInput{
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

// writeBodyArgs —— writeWritingBody 参数包，避开 argument-limit 5。
type writeBodyArgs struct {
	Rewrite map[string]string
	Tx      pgx.Tx
	Writing *domain.Writing
	In      *SaveWritingInput
	Deps    WritingsTxDeps
}

// writeWritingBody —— 用 rewrite map 把 pending 占位换成真 asset id，写最终
// body_md + cover_image_asset_id。
func writeWritingBody(ctx context.Context, a *writeBodyArgs) (domain.Writing, error) {
	body := rewriteRefs(a.In.BodyMD, a.Rewrite)
	cover := rewriteCoverRef(a.In.CoverImageRef, a.Rewrite)
	p, err := a.Deps.Writings.UpdateTx(ctx, a.Tx, &postgres.UpdateWritingInput{
		OwnerID: a.In.OwnerID, WritingID: a.Writing.ID(), Title: a.In.Title,
		Excerpt: a.In.Excerpt, BodyMD: body,
		CoverHeadline: a.In.CoverHeadline, CoverSub: a.In.CoverSub,
		CoverHue: a.In.CoverHue, CoverImageAssetID: cover,
		Tags: a.In.Tags, Visibility: a.In.Visibility, CrossRefs: a.In.CrossRefs,
		Path: a.Writing.Path(), ReadMinutes: estimateReadMinutes(body),
		LockedBody: a.In.LockedBody,
	})
	if err != nil {
		return domain.Writing{}, fmt.Errorf("update writing body: %w", err)
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

// DeleteWritingWithAssets 在 writings_delete.go。
