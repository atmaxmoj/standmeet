// corpus_crud.go —— raw + wiki + output 的 admin edit / delete / promote-aux
// 操作，从 corpus.go / output.go 主体拆出来，守 350 行 max-lines。
//
// 命名规则跟 sqlc 生成的 query 对齐：RawRepo.UpdateBody / Archive；
// WikiRepo.Update / Delete；OutputRepo.Update / Delete。

package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/postgres/dbq"
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

// UpdateBody 改 raw_entries body + tags + flagged_private（source 不改）。
func (r *RawRepo) UpdateBody(
	ctx context.Context, in *UpdateRawInput,
) (domain.Raw, error) {
	ownerUUID, err := parseUUID(in.OwnerID)
	if err != nil {
		return domain.Raw{}, fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	rawUUID, err := parseUUID(in.ID)
	if err != nil {
		return domain.Raw{}, fmt.Errorf("parse raw id: %w", err)
	}
	q := dbq.New(r.pool)
	row, qerr := q.UpdateRawBody(ctx, dbq.UpdateRawBodyParams{
		ID: rawUUID, OwnerID: ownerUUID,
		Body: in.Body, Tags: in.Tags, FlaggedPrivate: in.FlaggedPrivate,
	})
	if qerr != nil {
		if errors.Is(qerr, pgx.ErrNoRows) {
			return domain.Raw{}, domain.ErrRawNotFound
		}
		return domain.Raw{}, fmt.Errorf("update raw: %w", qerr)
	}
	return toDomainRaw(&row), nil
}

// Archive 把 raw_entries.archived 置 true（delete 走 archive，soft-delete
// 让 retention / audit 仍可见）。
func (r *RawRepo) Archive(ctx context.Context, ownerID, rawID string) error {
	ownerUUID, err := parseUUID(ownerID)
	if err != nil {
		return fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	rawUUID, err := parseUUID(rawID)
	if err != nil {
		return fmt.Errorf("parse raw id: %w", err)
	}
	q := dbq.New(r.pool)
	aerr := q.ArchiveRaw(ctx, dbq.ArchiveRawParams{ID: rawUUID, OwnerID: ownerUUID})
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
) (domain.Wiki, error) {
	params, err := buildWikiUpdateParams(in)
	if err != nil {
		return domain.Wiki{}, err
	}
	q := dbq.New(r.pool)
	row, qerr := q.UpdateNoteBody(ctx, params)
	if qerr != nil {
		if errors.Is(qerr, pgx.ErrNoRows) {
			return domain.Wiki{}, domain.ErrWikiNotFound
		}
		return domain.Wiki{}, fmt.Errorf("update wiki: %w", qerr)
	}
	return toDomainWiki(&row), nil
}

func buildWikiUpdateParams(in *UpdateWikiInput) (dbq.UpdateNoteBodyParams, error) {
	ownerUUID, err := parseUUID(in.OwnerID)
	if err != nil {
		return dbq.UpdateNoteBodyParams{}, fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	wikiUUID, err := parseUUID(in.ID)
	if err != nil {
		return dbq.UpdateNoteBodyParams{}, fmt.Errorf("parse wiki id: %w", err)
	}
	parent, err := parseOptionalUUID(in.ParentID)
	if err != nil {
		return dbq.UpdateNoteBodyParams{}, fmt.Errorf("parse parent id: %w", err)
	}
	return dbq.UpdateNoteBodyParams{
		ID: wikiUUID, OwnerID: ownerUUID, Genre: genreWiki,
		Title: in.Title, Body: in.Body, Tags: in.Tags,
		ParentID: parent, ShowAsSource: in.ShowAsSource, CssClasses: nilSafeTags(in.CSSClasses),
	}, nil
}

// Delete 硬删一条 wiki。FK ON DELETE 链：media_assets.wiki_entry_id 置 NULL。
// output.source_wiki_ids 是 uuid[]，不会被 cascade 影响（残留 wiki id 不致命）。
func (r *WikiRepo) Delete(ctx context.Context, ownerID, wikiID string) error {
	ownerUUID, err := parseUUID(ownerID)
	if err != nil {
		return fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	wikiUUID, err := parseUUID(wikiID)
	if err != nil {
		return fmt.Errorf("parse wiki id: %w", err)
	}
	q := dbq.New(r.pool)
	derr := q.DeleteNote(ctx, dbq.DeleteNoteParams{
		ID: wikiUUID, OwnerID: ownerUUID, Genre: genreWiki,
	})
	if derr != nil {
		return fmt.Errorf("delete wiki: %w", derr)
	}
	return nil
}

// cited id → title+path 的批量反查(GetTitlesByIDs)退役了:transcript hydration
// 改在 usecases.GetConversationTranscript 里 load 全树 + WikiTreePaths 算地址
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
) (domain.Output, error) {
	params, err := buildOutputUpdateParams(in)
	if err != nil {
		return domain.Output{}, err
	}
	q := dbq.New(r.pool)
	row, qerr := q.UpdateNoteBody(ctx, params)
	if qerr != nil {
		if errors.Is(qerr, pgx.ErrNoRows) {
			return domain.Output{}, domain.ErrOutputNotFound
		}
		return domain.Output{}, fmt.Errorf("update output: %w", qerr)
	}
	return toDomainOutput(&row), nil
}

func buildOutputUpdateParams(in *UpdateOutputInput) (dbq.UpdateNoteBodyParams, error) {
	ownerUUID, err := parseUUID(in.OwnerID)
	if err != nil {
		return dbq.UpdateNoteBodyParams{}, fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	outputUUID, err := parseUUID(in.ID)
	if err != nil {
		return dbq.UpdateNoteBodyParams{}, fmt.Errorf("parse output id: %w", err)
	}
	parent, err := parseOptionalUUID(in.ParentID)
	if err != nil {
		return dbq.UpdateNoteBodyParams{}, fmt.Errorf("parse parent id: %w", err)
	}
	return dbq.UpdateNoteBodyParams{
		ID: outputUUID, OwnerID: ownerUUID, Genre: genreOutput,
		Title: in.Title, Body: in.Body, Tags: in.Tags,
		ParentID: parent, ShowAsSource: in.ShowAsSource,
	}, nil
}

// Delete 硬删一条 output。
func (r *OutputRepo) Delete(ctx context.Context, ownerID, outputID string) error {
	ownerUUID, err := parseUUID(ownerID)
	if err != nil {
		return fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	outputUUID, err := parseUUID(outputID)
	if err != nil {
		return fmt.Errorf("parse output id: %w", err)
	}
	q := dbq.New(r.pool)
	derr := q.DeleteNote(ctx, dbq.DeleteNoteParams{
		ID: outputUUID, OwnerID: ownerUUID, Genre: genreOutput,
	})
	if derr != nil {
		return fmt.Errorf("delete output: %w", derr)
	}
	return nil
}
