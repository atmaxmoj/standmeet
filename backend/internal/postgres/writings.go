// writings.go —— corpus_notes(genre='writing') CRUD 视图。writing 折进统一
// note 基座(#151):body(markdown text 直存)对应旧 body_md；cover_image_asset_id
// 可空 (typographic-only writing 不挂图)。slug 冲突翻 ErrWritingSlugTaken。

package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/corpus"
	"github.com/atmaxmoj/standmeet/internal/pgstore"
	"github.com/atmaxmoj/standmeet/internal/postgres/dbq"
)

// WritingRepo —— corpus_notes(genre='writing') CRUD 视图。
type WritingRepo struct {
	pool *Pool
}

// NewWritingRepo 构造。
func NewWritingRepo(pool *Pool) *WritingRepo { return &WritingRepo{pool: pool} }

// Pool —— usecase 开 tx 用。create / update writing 跟 assets 写需要同事务。
func (r *WritingRepo) Pool() *Pool { return r.pool }

// CreateWritingInput —— Create 入参。BodyMD 是 markdown 原文，本层透传。
// path 不再是入参:writing 折进 corpus_notes 后 path 派生自 slug,不存列。
type CreateWritingInput struct {
	CoverImageAssetID *string
	OwnerID           string
	Slug              string
	Title             string
	Excerpt           string
	BodyMD            string
	CoverHeadline     string
	CoverHue          string
	Visibility        string
	LockedBody        string
	ParentID          string
	Tags              []string
	CrossRefs         []string
	ReadMinutes       int32
	Publish           bool
}

// Create —— 新建 writing 行 (no tx)。
func (r *WritingRepo) Create(
	ctx context.Context, in *CreateWritingInput,
) (corpus.Writing, error) {
	return r.CreateTx(ctx, r.pool, in)
}

// CreateTx —— 在 caller 给的 tx 里新建 writing，跟 assets 写同事务用。
// Publish=true 一并 published_at=now。slug 冲突翻 ErrWritingSlugTaken。
func (*WritingRepo) CreateTx(
	ctx context.Context, tx dbq.DBTX, in *CreateWritingInput,
) (corpus.Writing, error) {
	params, perr := buildCreateWritingParams(in)
	if perr != nil {
		return corpus.Writing{}, perr
	}
	row, err := dbq.New(tx).CreateWriting(ctx, *params)
	if err != nil {
		name, hit := pgstore.UniqueViolation(err)
		if hit && name == "corpus_notes_writing_slug_uniq" {
			return corpus.Writing{}, corpus.ErrWritingSlugTaken
		}
		return corpus.Writing{}, fmt.Errorf("create writing: %w", err)
	}
	return toDomainWriting(&row), nil
}

func buildCreateWritingParams(in *CreateWritingInput) (*dbq.CreateWritingParams, error) {
	ownerUUID, oerr := parseUUID(in.OwnerID)
	if oerr != nil {
		return nil, fmt.Errorf(errParseOwnerIDPrefix, oerr)
	}
	var publishedAt pgtype.Timestamptz
	if in.Publish {
		publishedAt = nowTimestamptz()
	}
	assetID, aerr := optAssetUUID(in.CoverImageAssetID)
	if aerr != nil {
		return nil, aerr
	}
	parentID, perr := pgstore.ParseOptionalUUID(&in.ParentID)
	if perr != nil {
		return nil, fmt.Errorf("parse writing parent id: %w", perr)
	}
	return &dbq.CreateWritingParams{
		OwnerID: ownerUUID, Slug: in.Slug, Title: in.Title, Excerpt: in.Excerpt,
		Body: in.BodyMD, CoverHeadline: in.CoverHeadline,
		CoverHue: writingCoverHueOr(in.CoverHue), CoverImageAssetID: assetID,
		Tags: nilSafeTags(in.Tags), Visibility: writingVisibilityOr(in.Visibility),
		CrossRefs:   nilSafeTags(in.CrossRefs),
		ReadMinutes: in.ReadMinutes, LockedBody: in.LockedBody,
		PublishedAt: publishedAt, ParentID: parentID, Published: in.Publish,
	}, nil
}

func optAssetUUID(id *string) (pgtype.UUID, error) {
	if id == nil || *id == "" {
		return pgtype.UUID{}, nil
	}
	u, err := parseUUID(*id)
	if err != nil {
		return pgtype.UUID{}, fmt.Errorf("parse cover asset id: %w", err)
	}
	return u, nil
}

// nowTimestamptz —— published_at=now() 的便利构造。caller (Create) 已经
// 在 input.Publish=false 时不调本函数。
func nowTimestamptz() pgtype.Timestamptz {
	return pgtype.Timestamptz{Time: time.Now(), Valid: true}
}

// UpdateWritingInput —— Update 入参。不动 slug / publish 状态 / created_at。
// path 不再是入参:折进 corpus_notes 后 path 派生自 slug,不存列。
type UpdateWritingInput struct {
	CoverImageAssetID *string
	OwnerID           string
	WritingID         string
	Title             string
	Excerpt           string
	BodyMD            string
	CoverHeadline     string
	CoverHue          string
	Visibility        string
	LockedBody        string
	ParentID          string
	Tags              []string
	CrossRefs         []string
	ReadMinutes       int32
}

// Update —— 全字段覆盖 (no tx)。
func (r *WritingRepo) Update(
	ctx context.Context, in *UpdateWritingInput,
) (corpus.Writing, error) {
	return r.UpdateTx(ctx, r.pool, in)
}

// UpdateTx —— 全字段覆盖 (除 slug / 发布状态)，tx 版。assets 同事务写。
func (*WritingRepo) UpdateTx(
	ctx context.Context, tx dbq.DBTX, in *UpdateWritingInput,
) (corpus.Writing, error) {
	params, perr := buildUpdateWritingParams(in)
	if perr != nil {
		return corpus.Writing{}, perr
	}
	row, err := dbq.New(tx).UpdateWriting(ctx, *params)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return corpus.Writing{}, corpus.ErrWritingNotFound
		}
		return corpus.Writing{}, fmt.Errorf("update writing: %w", err)
	}
	return toDomainWriting(&row), nil
}

func buildUpdateWritingParams(in *UpdateWritingInput) (*dbq.UpdateWritingParams, error) {
	args, perr := parseOwnerAndWritingID(in.OwnerID, in.WritingID)
	if perr != nil {
		return nil, perr
	}
	assetID, aerr := optAssetUUID(in.CoverImageAssetID)
	if aerr != nil {
		return nil, aerr
	}
	parentID, perr := pgstore.ParseOptionalUUID(&in.ParentID)
	if perr != nil {
		return nil, fmt.Errorf("parse writing parent id: %w", perr)
	}
	return &dbq.UpdateWritingParams{
		ID: args.writingUUID, OwnerID: args.ownerUUID,
		Title: in.Title, Excerpt: in.Excerpt, Body: in.BodyMD,
		CoverHeadline: in.CoverHeadline,
		CoverHue:      writingCoverHueOr(in.CoverHue), CoverImageAssetID: assetID,
		Tags: nilSafeTags(in.Tags), Visibility: writingVisibilityOr(in.Visibility),
		CrossRefs:   nilSafeTags(in.CrossRefs),
		ReadMinutes: in.ReadMinutes, LockedBody: in.LockedBody, ParentID: parentID,
	}, nil
}

// Publish —— published_at = now，slug/body 保留。
func (r *WritingRepo) Publish(
	ctx context.Context, ownerID, writingID string,
) (corpus.Writing, error) {
	args, perr := parseOwnerAndWritingID(ownerID, writingID)
	if perr != nil {
		return corpus.Writing{}, perr
	}
	row, err := dbq.New(r.pool).PublishWriting(ctx, dbq.PublishWritingParams{
		ID: args.writingUUID, OwnerID: args.ownerUUID,
	})
	return toDomainWritingOrErr(&row, err)
}

// Unpublish —— published_at = NULL，撤回到草稿。
func (r *WritingRepo) Unpublish(
	ctx context.Context, ownerID, writingID string,
) (corpus.Writing, error) {
	args, perr := parseOwnerAndWritingID(ownerID, writingID)
	if perr != nil {
		return corpus.Writing{}, perr
	}
	row, err := dbq.New(r.pool).UnpublishWriting(ctx, dbq.UnpublishWritingParams{
		ID: args.writingUUID, OwnerID: args.ownerUUID,
	})
	return toDomainWritingOrErr(&row, err)
}

func toDomainWritingOrErr(row *dbq.CorpusNote, err error) (corpus.Writing, error) {
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return corpus.Writing{}, corpus.ErrWritingNotFound
		}
		return corpus.Writing{}, fmt.Errorf("writing publish flip: %w", err)
	}
	return toDomainWriting(row), nil
}

// Delete —— 物理删 (no tx)。usecase 层会先 list+delete assets 同事务再调
// 这个，所以这里只删 writings 行本身。
func (r *WritingRepo) Delete(ctx context.Context, ownerID, writingID string) error {
	return r.DeleteTx(ctx, r.pool, ownerID, writingID)
}

// DeleteTx —— 物理删 writing 行（tx 版）。caller 必须在同事务先 DELETE assets
// WHERE holder_id = writingID（usecase 层负责）。
func (*WritingRepo) DeleteTx(ctx context.Context, tx dbq.DBTX, ownerID, writingID string) error {
	args, perr := parseOwnerAndWritingID(ownerID, writingID)
	if perr != nil {
		return perr
	}
	if err := dbq.New(tx).DeleteWriting(ctx, dbq.DeleteWritingParams{
		ID: args.writingUUID, OwnerID: args.ownerUUID,
	}); err != nil {
		return fmt.Errorf("delete writing: %w", err)
	}
	return nil
}

// GetByID —— admin 取单条；属于 owner 校验。
func (r *WritingRepo) GetByID(
	ctx context.Context, ownerID, writingID string,
) (corpus.Writing, error) {
	args, perr := parseOwnerAndWritingID(ownerID, writingID)
	if perr != nil {
		return corpus.Writing{}, perr
	}
	row, err := dbq.New(r.pool).GetWritingByID(ctx, dbq.GetWritingByIDParams{
		ID: args.writingUUID, OwnerID: args.ownerUUID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return corpus.Writing{}, corpus.ErrWritingNotFound
		}
		return corpus.Writing{}, fmt.Errorf("get writing by id: %w", err)
	}
	return toDomainWriting(&row), nil
}

// GetBySlug —— public 取单条；按 owner+slug 唯一索引查。
func (r *WritingRepo) GetBySlug(
	ctx context.Context, ownerID, slug string,
) (corpus.Writing, error) {
	ownerUUID, oerr := parseUUID(ownerID)
	if oerr != nil {
		return corpus.Writing{}, fmt.Errorf(errParseOwnerIDPrefix, oerr)
	}
	row, err := dbq.New(r.pool).GetWritingBySlug(ctx, dbq.GetWritingBySlugParams{
		OwnerID: ownerUUID, Slug: slug,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return corpus.Writing{}, corpus.ErrWritingNotFound
		}
		return corpus.Writing{}, fmt.Errorf("get writing by slug: %w", err)
	}
	return toDomainWriting(&row), nil
}

// ListByOwner —— admin 列表 (含未发布草稿)，按 published_at desc nulls last。
func (r *WritingRepo) ListByOwner(
	ctx context.Context, ownerID string,
) ([]corpus.Writing, error) {
	ownerUUID, oerr := parseUUID(ownerID)
	if oerr != nil {
		return nil, fmt.Errorf(errParseOwnerIDPrefix, oerr)
	}
	rows, err := dbq.New(r.pool).ListWritingsByOwner(ctx, ownerUUID)
	if err != nil {
		return nil, fmt.Errorf("list writings by owner: %w", err)
	}
	return rowsToDomainWritings(rows), nil
}

// ListPublishedByOwner —— public list (只 already-published)；不分页 (visitor
// chat retriever 用)。
func (r *WritingRepo) ListPublishedByOwner(
	ctx context.Context, ownerID string,
) ([]corpus.Writing, error) {
	ownerUUID, oerr := parseUUID(ownerID)
	if oerr != nil {
		return nil, fmt.Errorf(errParseOwnerIDPrefix, oerr)
	}
	rows, err := dbq.New(r.pool).ListPublishedWritingsByOwner(ctx, ownerUUID)
	if err != nil {
		return nil, fmt.Errorf("list published writings: %w", err)
	}
	return rowsToDomainWritings(rows), nil
}

// ListPublishedPageInput —— infinite-scroll 分页入参。Cursor 是上一页末
// 条 published_at；首页传 nil 拿最新 limit 条。
type ListPublishedPageInput struct {
	Cursor  *time.Time
	OwnerID string
	Limit   int32
}

// ListPublishedPageByOwner —— /api/v1/writings?cursor=...&limit=... 用。
func (r *WritingRepo) ListPublishedPageByOwner(
	ctx context.Context, in *ListPublishedPageInput,
) ([]corpus.Writing, error) {
	ownerUUID, oerr := parseUUID(in.OwnerID)
	if oerr != nil {
		return nil, fmt.Errorf(errParseOwnerIDPrefix, oerr)
	}
	cursor := pgtype.Timestamptz{}
	if in.Cursor != nil {
		cursor = pgtype.Timestamptz{Time: *in.Cursor, Valid: true}
	}
	rows, err := dbq.New(r.pool).ListPublishedWritingsByOwnerPage(ctx,
		dbq.ListPublishedWritingsByOwnerPageParams{
			OwnerID: ownerUUID, Column2: cursor, Limit: in.Limit,
		})
	if err != nil {
		return nil, fmt.Errorf("list published writings page: %w", err)
	}
	return rowsToDomainWritings(rows), nil
}
