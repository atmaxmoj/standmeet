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
	"github.com/jackc/pgx/v5/pgtype"

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
	ShowAsSource bool
}

// Update 改 wiki_entries 主字段；SEO 走 SetSEO 单独写。
func (r *WikiRepo) Update(
	ctx context.Context, in *UpdateWikiInput,
) (domain.Wiki, error) {
	params, err := buildWikiUpdateParams(in)
	if err != nil {
		return domain.Wiki{}, err
	}
	q := dbq.New(r.pool)
	row, qerr := q.UpdateWikiBody(ctx, params)
	if qerr != nil {
		if errors.Is(qerr, pgx.ErrNoRows) {
			return domain.Wiki{}, domain.ErrWikiNotFound
		}
		return domain.Wiki{}, fmt.Errorf("update wiki: %w", qerr)
	}
	return toDomainWiki(&row), nil
}

func buildWikiUpdateParams(in *UpdateWikiInput) (dbq.UpdateWikiBodyParams, error) {
	ownerUUID, err := parseUUID(in.OwnerID)
	if err != nil {
		return dbq.UpdateWikiBodyParams{}, fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	wikiUUID, err := parseUUID(in.ID)
	if err != nil {
		return dbq.UpdateWikiBodyParams{}, fmt.Errorf("parse wiki id: %w", err)
	}
	parent, err := parseOptionalUUID(in.ParentID)
	if err != nil {
		return dbq.UpdateWikiBodyParams{}, fmt.Errorf("parse parent id: %w", err)
	}
	return dbq.UpdateWikiBodyParams{
		ID: wikiUUID, OwnerID: ownerUUID,
		Title: in.Title, Body: in.Body, Tags: in.Tags,
		ParentID: parent, ShowAsSource: in.ShowAsSource,
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
	derr := q.DeleteWiki(ctx, dbq.DeleteWikiParams{ID: wikiUUID, OwnerID: ownerUUID})
	if derr != nil {
		return fmt.Errorf("delete wiki: %w", derr)
	}
	return nil
}

// TitledRef —— 批量解 cited id → title+path 的最小映射 view。
// conversations transcript hydration / visitor chat done event 复用。
type TitledRef struct {
	ID    string
	Title string
	Path  string
}

// GetTitlesByIDs —— transcript hydration：批量解 wiki id → title。空 ids
// 返空 slice，不走 DB。
func (r *WikiRepo) GetTitlesByIDs(
	ctx context.Context, ownerID string, ids []string,
) ([]TitledRef, error) {
	if len(ids) == 0 {
		return []TitledRef{}, nil
	}
	args, perr := parseTitleLookupArgs(ownerID, ids)
	if perr != nil {
		return []TitledRef{}, perr
	}
	rows, err := dbq.New(r.pool).GetWikiTitlesByIDs(ctx, dbq.GetWikiTitlesByIDsParams{
		OwnerID: args.ownerUUID, Column2: args.idUUIDs,
	})
	if err != nil {
		return nil, fmt.Errorf("get wiki titles: %w", err)
	}
	return wikiRowsToRefs(rows), nil
}

func wikiRowsToRefs(rows []dbq.GetWikiTitlesByIDsRow) []TitledRef {
	out := make([]TitledRef, 0, len(rows))
	for i := range rows {
		ref := TitledRef{ID: formatUUID(rows[i].ID), Title: rows[i].Title}
		if rows[i].Path != nil {
			ref.Path = *rows[i].Path
		}
		out = append(out, ref)
	}
	return out
}

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

// Update 改 output_entries 主字段。
func (r *OutputRepo) Update(
	ctx context.Context, in *UpdateOutputInput,
) (domain.Output, error) {
	params, err := buildOutputUpdateParams(in)
	if err != nil {
		return domain.Output{}, err
	}
	q := dbq.New(r.pool)
	row, qerr := q.UpdateOutputBody(ctx, params)
	if qerr != nil {
		if errors.Is(qerr, pgx.ErrNoRows) {
			return domain.Output{}, domain.ErrOutputNotFound
		}
		return domain.Output{}, fmt.Errorf("update output: %w", qerr)
	}
	return toDomainOutput(&row), nil
}

func buildOutputUpdateParams(in *UpdateOutputInput) (dbq.UpdateOutputBodyParams, error) {
	ownerUUID, err := parseUUID(in.OwnerID)
	if err != nil {
		return dbq.UpdateOutputBodyParams{}, fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	outputUUID, err := parseUUID(in.ID)
	if err != nil {
		return dbq.UpdateOutputBodyParams{}, fmt.Errorf("parse output id: %w", err)
	}
	parent, err := parseOptionalUUID(in.ParentID)
	if err != nil {
		return dbq.UpdateOutputBodyParams{}, fmt.Errorf("parse parent id: %w", err)
	}
	return dbq.UpdateOutputBodyParams{
		ID: outputUUID, OwnerID: ownerUUID,
		Title: in.Title, Body: in.Body, Tags: in.Tags,
		ParentID: parent, ShowAsSource: in.ShowAsSource,
	}, nil
}

// GetTitlesByIDs —— transcript hydration：批量解 output id → title。
func (r *OutputRepo) GetTitlesByIDs(
	ctx context.Context, ownerID string, ids []string,
) ([]TitledRef, error) {
	if len(ids) == 0 {
		return []TitledRef{}, nil
	}
	args, perr := parseTitleLookupArgs(ownerID, ids)
	if perr != nil {
		return []TitledRef{}, perr
	}
	rows, err := dbq.New(r.pool).GetOutputTitlesByIDs(ctx, dbq.GetOutputTitlesByIDsParams{
		OwnerID: args.ownerUUID, Column2: args.idUUIDs,
	})
	if err != nil {
		return nil, fmt.Errorf("get output titles: %w", err)
	}
	return outputRowsToRefs(rows), nil
}

func outputRowsToRefs(rows []dbq.GetOutputTitlesByIDsRow) []TitledRef {
	out := make([]TitledRef, 0, len(rows))
	for i := range rows {
		ref := TitledRef{ID: formatUUID(rows[i].ID), Title: rows[i].Title}
		if rows[i].Path != nil {
			ref.Path = *rows[i].Path
		}
		out = append(out, ref)
	}
	return out
}

// titleLookupArgs —— GetTitlesByIDs (wiki / output) 共享的 uuid parse 结果。
type titleLookupArgs struct {
	idUUIDs   []pgtype.UUID
	ownerUUID pgtype.UUID
}

func parseTitleLookupArgs(ownerID string, ids []string) (titleLookupArgs, error) {
	ownerUUID, err := parseUUID(ownerID)
	if err != nil {
		return titleLookupArgs{}, fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	idUUIDs, err := parseUUIDArray(ids)
	if err != nil {
		return titleLookupArgs{}, fmt.Errorf("parse ids: %w", err)
	}
	return titleLookupArgs{ownerUUID: ownerUUID, idUUIDs: idUUIDs}, nil
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
	derr := q.DeleteOutput(ctx, dbq.DeleteOutputParams{ID: outputUUID, OwnerID: ownerUUID})
	if derr != nil {
		return fmt.Errorf("delete output: %w", derr)
	}
	return nil
}
