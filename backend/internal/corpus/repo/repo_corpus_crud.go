// corpus_crud.go —— raw + wiki + output 的 admin edit / delete / promote-aux
// 操作，从 corpus.go / output.go 主体拆出来，守 350 行 max-lines。
//
// 命名规则跟 sqlc 生成的 query 对齐：RawRepo.UpdateBody / Archive；
// WikiRepo.Update / Delete；OutputRepo.Update / Delete。

package repo

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/atmaxmoj/standmeet/internal/corpus/db"
	"github.com/atmaxmoj/standmeet/internal/corpus/entity"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// ─── raw ────────────────────────────────────────────────────

// UpdateRawInput —— admin "edit raw" 入参。
type UpdateRawInput struct {
	OwnerID        string
	ID             string
	Body           string
	Tags           []string
	FlaggedPrivate bool
}

// UpdateBody 改 raw(corpus_notes genre='raw') body + tags + flagged_private（inbox_source 不改）。
func (r *RawRepo) UpdateBody(
	ctx context.Context, in *UpdateRawInput,
) (entity.Raw, error) {
	ownerUUID, err := pgstore.ParseUUID(in.OwnerID)
	if err != nil {
		return entity.Raw{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	rawUUID, err := pgstore.ParseUUID(in.ID)
	if err != nil {
		return entity.Raw{}, fmt.Errorf("parse raw id: %w", err)
	}
	q := db.New(r.pool)
	row, qerr := q.UpdateRawBody(ctx, db.UpdateRawBodyParams{
		ID: rawUUID, OwnerID: ownerUUID,
		Body: in.Body, Tags: nilSafeTags(in.Tags), FlaggedPrivate: in.FlaggedPrivate,
	})
	if qerr != nil {
		if errors.Is(qerr, pgx.ErrNoRows) {
			return entity.Raw{}, entity.ErrRawNotFound
		}
		return entity.Raw{}, fmt.Errorf("update raw: %w", qerr)
	}
	return toDomainRaw(&row), nil
}

// Archive 把 raw(corpus_notes genre='raw').archived 置 true（delete 走 archive，soft-delete
// 让 retention / audit 仍可见）。
func (r *RawRepo) Archive(ctx context.Context, ownerID, rawID string) error {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	rawUUID, err := pgstore.ParseUUID(rawID)
	if err != nil {
		return fmt.Errorf("parse raw id: %w", err)
	}
	q := db.New(r.pool)
	aerr := q.ArchiveRaw(ctx, db.ArchiveRawParams{ID: rawUUID, OwnerID: ownerUUID})
	if aerr != nil {
		return fmt.Errorf("archive raw: %w", aerr)
	}
	return nil
}

// ─── wiki ───────────────────────────────────────────────────

// UpdateWikiInput —— admin "edit wiki" 入参。
type UpdateWikiInput struct {
	OwnerID      string
	ID           string
	ParentID     *string
	Title        string
	Body         string
	Tags         []string
	CSSClasses   []string
	ShowAsSource bool
}

// Update 改 wiki note（corpus_notes genre='wiki'）主字段；SEO 走 SetSEO 单独写。
func (r *WikiRepo) Update(
	ctx context.Context, in *UpdateWikiInput,
) (entity.Wiki, error) {
	params, err := buildWikiUpdateParams(in)
	if err != nil {
		return entity.Wiki{}, err
	}
	q := db.New(r.pool)
	row, qerr := q.UpdateNoteBody(ctx, params)
	if qerr != nil {
		if errors.Is(qerr, pgx.ErrNoRows) {
			return entity.Wiki{}, entity.ErrWikiNotFound
		}
		return entity.Wiki{}, fmt.Errorf("update wiki: %w", qerr)
	}
	return toDomainWiki(&row), nil
}

func buildWikiUpdateParams(in *UpdateWikiInput) (db.UpdateNoteBodyParams, error) {
	ownerUUID, err := pgstore.ParseUUID(in.OwnerID)
	if err != nil {
		return db.UpdateNoteBodyParams{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	wikiUUID, err := pgstore.ParseUUID(in.ID)
	if err != nil {
		return db.UpdateNoteBodyParams{}, fmt.Errorf("parse wiki id: %w", err)
	}
	parent, err := pgstore.ParseOptionalUUID(in.ParentID)
	if err != nil {
		return db.UpdateNoteBodyParams{}, fmt.Errorf("parse parent id: %w", err)
	}
	return db.UpdateNoteBodyParams{
		ID: wikiUUID, OwnerID: ownerUUID, Genre: genreWiki,
		Title: in.Title, Body: in.Body, Tags: nilSafeTags(in.Tags),
		ParentID: parent, ShowAsSource: in.ShowAsSource, CssClasses: nilSafeTags(in.CSSClasses),
	}, nil
}

// Delete 硬删一条 wiki。素材**不靠外键**跟着走:assets 按 holder_id 挂、没有 FK,
// 所以删条目那一步由上层先删素材再删条目(见 ops/corpus_write_media.go 的 dropEntryAssets)。
// output.source_wiki_ids 是 uuid[]，不会被 cascade 影响（残留 wiki id 不致命）。
func (r *WikiRepo) Delete(ctx context.Context, ownerID, wikiID string) error {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	wikiUUID, err := pgstore.ParseUUID(wikiID)
	if err != nil {
		return fmt.Errorf("parse wiki id: %w", err)
	}
	q := db.New(r.pool)
	derr := q.DeleteNote(ctx, db.DeleteNoteParams{
		ID: wikiUUID, OwnerID: ownerUUID, Genre: genreWiki,
	})
	if derr != nil {
		return fmt.Errorf("delete wiki: %w", derr)
	}
	return nil
}

// cited id → title+path 的批量反查(GetTitlesByIDs)退役了:transcript hydration
// 改在 conversation.GetConversationTranscript 里 load 全树 + WikiTreePaths 算地址
// (地址纯树派生,不读已退役的 path 列)。

// ─── output ─────────────────────────────────────────────────

// UpdateOutputInput —— admin "edit output" 入参。
type UpdateOutputInput struct {
	OwnerID      string
	ID           string
	ParentID     *string
	Title        string
	Body         string
	Tags         []string
	ShowAsSource bool
}

// Update 改 output note（corpus_notes genre='output'）主字段。
func (r *OutputRepo) Update(
	ctx context.Context, in *UpdateOutputInput,
) (entity.Output, error) {
	params, err := buildOutputUpdateParams(in)
	if err != nil {
		return entity.Output{}, err
	}
	q := db.New(r.pool)
	row, qerr := q.UpdateNoteBody(ctx, params)
	if qerr != nil {
		if errors.Is(qerr, pgx.ErrNoRows) {
			return entity.Output{}, entity.ErrOutputNotFound
		}
		return entity.Output{}, fmt.Errorf("update output: %w", qerr)
	}
	return toDomainOutput(&row), nil
}

func buildOutputUpdateParams(in *UpdateOutputInput) (db.UpdateNoteBodyParams, error) {
	ownerUUID, err := pgstore.ParseUUID(in.OwnerID)
	if err != nil {
		return db.UpdateNoteBodyParams{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	outputUUID, err := pgstore.ParseUUID(in.ID)
	if err != nil {
		return db.UpdateNoteBodyParams{}, fmt.Errorf("parse output id: %w", err)
	}
	parent, err := pgstore.ParseOptionalUUID(in.ParentID)
	if err != nil {
		return db.UpdateNoteBodyParams{}, fmt.Errorf("parse parent id: %w", err)
	}
	return db.UpdateNoteBodyParams{
		ID: outputUUID, OwnerID: ownerUUID, Genre: genreOutput,
		Title: in.Title, Body: in.Body, Tags: nilSafeTags(in.Tags),
		ParentID: parent, ShowAsSource: in.ShowAsSource, CssClasses: []string{},
	}, nil
}

// Delete 硬删一条 output。
func (r *OutputRepo) Delete(ctx context.Context, ownerID, outputID string) error {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	outputUUID, err := pgstore.ParseUUID(outputID)
	if err != nil {
		return fmt.Errorf("parse output id: %w", err)
	}
	q := db.New(r.pool)
	derr := q.DeleteNote(ctx, db.DeleteNoteParams{
		ID: outputUUID, OwnerID: ownerUUID, Genre: genreOutput,
	})
	if derr != nil {
		return fmt.Errorf("delete output: %w", derr)
	}
	return nil
}
