// writings.go — a CRUD view over corpus_notes(genre='writing'), folded into the unified
// note base (#151): body is raw markdown (was body_md); cover_image_asset_id is nullable
// (typographic-only writing). A slug conflict surfaces as ErrWritingSlugTaken.

package repo

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/corpus/db"
	"github.com/atmaxmoj/standmeet/internal/corpus/entity"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// WritingRepo — a CRUD view over corpus_notes(genre='writing').
type WritingRepo struct {
	pool *pgstore.Pool
}

// NewWritingRepo constructs one.
func NewWritingRepo(pool *pgstore.Pool) *WritingRepo { return &WritingRepo{pool: pool} }

// Pool — lets the usecase layer open a tx shared with writing the writing's assets.
func (r *WritingRepo) Pool() *pgstore.Pool { return r.pool }

// CreateWritingInput — Create's parameters. BodyMD is raw markdown, passed through
// unchanged. path isn't an input: since folding into corpus_notes, it derives from slug.
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

// Create — inserts a new writing row (no tx).
func (r *WritingRepo) Create(
	ctx context.Context, in *CreateWritingInput,
) (entity.Writing, error) {
	return r.CreateTx(ctx, r.pool, in)
}

// CreateTx — inserts a writing inside the caller's tx (shared with writing its assets).
// Publish=true also sets published_at=now. A slug conflict surfaces as ErrWritingSlugTaken.
func (*WritingRepo) CreateTx(
	ctx context.Context, tx db.DBTX, in *CreateWritingInput,
) (entity.Writing, error) {
	params, perr := buildCreateWritingParams(in)
	if perr != nil {
		return entity.Writing{}, perr
	}
	row, err := db.New(tx).CreateWriting(ctx, *params)
	if err != nil {
		name, hit := pgstore.UniqueViolation(err)
		if hit && name == "corpus_notes_writing_slug_uniq" {
			return entity.Writing{}, entity.ErrWritingSlugTaken
		}
		return entity.Writing{}, fmt.Errorf("create writing: %w", err)
	}
	return toDomainWriting(&row), nil
}

func buildCreateWritingParams(in *CreateWritingInput) (*db.CreateWritingParams, error) {
	ownerUUID, oerr := pgstore.ParseUUID(in.OwnerID)
	if oerr != nil {
		return nil, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, oerr)
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
	return &db.CreateWritingParams{
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
	u, err := pgstore.ParseUUID(*id)
	if err != nil {
		return pgtype.UUID{}, fmt.Errorf("parse cover asset id: %w", err)
	}
	return u, nil
}

// nowTimestamptz — constructs published_at=now(); Create skips it when Publish=false.
func nowTimestamptz() pgtype.Timestamptz {
	return pgtype.Timestamptz{Time: time.Now(), Valid: true}
}

// UpdateWritingInput — never touches slug/publish state/created_at; path derives from slug.
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

// Update — overwrites all fields (no tx).
func (r *WritingRepo) Update(
	ctx context.Context, in *UpdateWritingInput,
) (entity.Writing, error) {
	return r.UpdateTx(ctx, r.pool, in)
}

// UpdateTx — overwrites fields except slug/publish state, tx version (assets share this tx).
func (*WritingRepo) UpdateTx(
	ctx context.Context, tx db.DBTX, in *UpdateWritingInput,
) (entity.Writing, error) {
	params, perr := buildUpdateWritingParams(in)
	if perr != nil {
		return entity.Writing{}, perr
	}
	row, err := db.New(tx).UpdateWriting(ctx, *params)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return entity.Writing{}, entity.ErrWritingNotFound
		}
		return entity.Writing{}, fmt.Errorf("update writing: %w", err)
	}
	return toDomainWriting(&row), nil
}

func buildUpdateWritingParams(in *UpdateWritingInput) (*db.UpdateWritingParams, error) {
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
	return &db.UpdateWritingParams{
		ID: args.writingUUID, OwnerID: args.ownerUUID,
		Title: in.Title, Excerpt: in.Excerpt, Body: in.BodyMD,
		CoverHeadline: in.CoverHeadline,
		CoverHue:      writingCoverHueOr(in.CoverHue), CoverImageAssetID: assetID,
		Tags: nilSafeTags(in.Tags), Visibility: writingVisibilityOr(in.Visibility),
		CrossRefs:   nilSafeTags(in.CrossRefs),
		ReadMinutes: in.ReadMinutes, LockedBody: in.LockedBody, ParentID: parentID,
	}, nil
}

// Publish — sets published_at = now; slug/body are left as-is.
func (r *WritingRepo) Publish(
	ctx context.Context, ownerID, writingID string,
) (entity.Writing, error) {
	args, perr := parseOwnerAndWritingID(ownerID, writingID)
	if perr != nil {
		return entity.Writing{}, perr
	}
	row, err := db.New(r.pool).PublishWriting(ctx, db.PublishWritingParams{
		ID: args.writingUUID, OwnerID: args.ownerUUID,
	})
	return toDomainWritingOrErr(&row, err)
}

// Unpublish — sets published_at = NULL, reverting to draft.
func (r *WritingRepo) Unpublish(
	ctx context.Context, ownerID, writingID string,
) (entity.Writing, error) {
	args, perr := parseOwnerAndWritingID(ownerID, writingID)
	if perr != nil {
		return entity.Writing{}, perr
	}
	row, err := db.New(r.pool).UnpublishWriting(ctx, db.UnpublishWritingParams{
		ID: args.writingUUID, OwnerID: args.ownerUUID,
	})
	return toDomainWritingOrErr(&row, err)
}

func toDomainWritingOrErr(row *db.CorpusNote, err error) (entity.Writing, error) {
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return entity.Writing{}, entity.ErrWritingNotFound
		}
		return entity.Writing{}, fmt.Errorf("writing publish flip: %w", err)
	}
	return toDomainWriting(row), nil
}

// Delete — a hard delete (no tx); the usecase layer deletes assets in its own tx first.
func (r *WritingRepo) Delete(ctx context.Context, ownerID, writingID string) error {
	return r.DeleteTx(ctx, r.pool, ownerID, writingID)
}

// DeleteTx — a hard delete of the writing row (tx version); caller must first DELETE
// assets WHERE holder_id = writingID in the same tx (usecase layer's job).
func (*WritingRepo) DeleteTx(ctx context.Context, tx db.DBTX, ownerID, writingID string) error {
	args, perr := parseOwnerAndWritingID(ownerID, writingID)
	if perr != nil {
		return perr
	}
	if err := db.New(tx).DeleteWriting(ctx, db.DeleteWritingParams{
		ID: args.writingUUID, OwnerID: args.ownerUUID,
	}); err != nil {
		return fmt.Errorf("delete writing: %w", err)
	}
	return nil
}

// GetByID — admin fetches a single row; checked against the owner.
func (r *WritingRepo) GetByID(
	ctx context.Context, ownerID, writingID string,
) (entity.Writing, error) {
	args, perr := parseOwnerAndWritingID(ownerID, writingID)
	if perr != nil {
		return entity.Writing{}, perr
	}
	row, err := db.New(r.pool).GetWritingByID(ctx, db.GetWritingByIDParams{
		ID: args.writingUUID, OwnerID: args.ownerUUID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return entity.Writing{}, entity.ErrWritingNotFound
		}
		return entity.Writing{}, fmt.Errorf("get writing by id: %w", err)
	}
	return toDomainWriting(&row), nil
}

// GetBySlug — public fetches a single row; looked up by the owner+slug unique index.
func (r *WritingRepo) GetBySlug(
	ctx context.Context, ownerID, slug string,
) (entity.Writing, error) {
	ownerUUID, oerr := pgstore.ParseUUID(ownerID)
	if oerr != nil {
		return entity.Writing{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, oerr)
	}
	row, err := db.New(r.pool).GetWritingBySlug(ctx, db.GetWritingBySlugParams{
		OwnerID: ownerUUID, Slug: slug,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return entity.Writing{}, entity.ErrWritingNotFound
		}
		return entity.Writing{}, fmt.Errorf("get writing by slug: %w", err)
	}
	return toDomainWriting(&row), nil
}

// ListByOwner — the admin listing (includes drafts), ordered by published_at desc nulls last.
func (r *WritingRepo) ListByOwner(
	ctx context.Context, ownerID string,
) ([]entity.Writing, error) {
	ownerUUID, oerr := pgstore.ParseUUID(ownerID)
	if oerr != nil {
		return nil, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, oerr)
	}
	rows, err := db.New(r.pool).ListWritingsByOwner(ctx, ownerUUID)
	if err != nil {
		return nil, fmt.Errorf("list writings by owner: %w", err)
	}
	return rowsToDomainWritings(rows), nil
}

// ListPublishedByOwner — the public list (published only); unpaginated (visitor chat retriever).
func (r *WritingRepo) ListPublishedByOwner(
	ctx context.Context, ownerID string,
) ([]entity.Writing, error) {
	ownerUUID, oerr := pgstore.ParseUUID(ownerID)
	if oerr != nil {
		return nil, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, oerr)
	}
	rows, err := db.New(r.pool).ListPublishedWritingsByOwner(ctx, ownerUUID)
	if err != nil {
		return nil, fmt.Errorf("list published writings: %w", err)
	}
	return rowsToDomainWritings(rows), nil
}

// ListPublishedPageInput — pagination params: cursor=prev page's published_at; nil=first page.
type ListPublishedPageInput struct {
	Cursor  *time.Time
	OwnerID string
	Limit   int32
}

// ListPublishedPageByOwner — used by /api/v1/writings?cursor=...&limit=....
func (r *WritingRepo) ListPublishedPageByOwner(
	ctx context.Context, in *ListPublishedPageInput,
) ([]entity.Writing, error) {
	ownerUUID, oerr := pgstore.ParseUUID(in.OwnerID)
	if oerr != nil {
		return nil, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, oerr)
	}
	cursor := pgtype.Timestamptz{}
	if in.Cursor != nil {
		cursor = pgtype.Timestamptz{Time: *in.Cursor, Valid: true}
	}
	rows, err := db.New(r.pool).ListPublishedWritingsByOwnerPage(ctx,
		db.ListPublishedWritingsByOwnerPageParams{
			OwnerID: ownerUUID, Column2: cursor, Limit: in.Limit,
		})
	if err != nil {
		return nil, fmt.Errorf("list published writings page: %w", err)
	}
	return rowsToDomainWritings(rows), nil
}
