// prompts.go —— prompts table CRUD. An owner-scoped persona library.
//
// Design: [[iam-role-pivot-plan]]. The public one (is_builtin=true) is
// upserted in by SeedPublicRole at owner claim time; deletion is blocked
// by the repo layer (ErrPromptBuiltinImmutable).

package repo

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/owner/db"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
)

// PromptRepo —— prompts table CRUD.
type PromptRepo struct {
	pool *pgstore.Pool
}

// NewPromptRepo constructs one.
func NewPromptRepo(pool *pgstore.Pool) *PromptRepo { return &PromptRepo{pool: pool} }

// CreatePromptInput —— Create's input.
type CreatePromptInput struct {
	OwnerID     string
	Name        string
	Description string
	Body        string
}

// Create creates a new prompt. A name conflict translates to
// ErrPromptNameTaken.
func (r *PromptRepo) Create(ctx context.Context, in *CreatePromptInput) (entity.Prompt, error) {
	ownerUUID, oerr := pgstore.ParseUUID(in.OwnerID)
	if oerr != nil {
		return entity.Prompt{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, oerr)
	}
	row, err := db.New(r.pool).CreatePrompt(ctx, db.CreatePromptParams{
		OwnerID: ownerUUID, Name: in.Name, Description: in.Description, Body: in.Body,
	})
	if err != nil {
		if name, hit := pgstore.UniqueViolation(err); hit && name == "prompts_owner_name_uniq" {
			return entity.Prompt{}, entity.ErrPromptNameTaken
		}
		return entity.Prompt{}, fmt.Errorf("create prompt: %w", err)
	}
	return toDomainPrompt(&row), nil
}

// UpsertBuiltin —— used by SeedPublicRole. Overwrites description / body
// for the same (owner_id, name).
func (r *PromptRepo) UpsertBuiltin(
	ctx context.Context, ownerID, name, description, body string,
) (entity.Prompt, error) {
	ownerUUID, oerr := pgstore.ParseUUID(ownerID)
	if oerr != nil {
		return entity.Prompt{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, oerr)
	}
	row, err := db.New(r.pool).UpsertBuiltinPrompt(ctx, db.UpsertBuiltinPromptParams{
		OwnerID: ownerUUID, Name: name, Description: description, Body: body,
	})
	if err != nil {
		return entity.Prompt{}, fmt.Errorf("upsert builtin prompt: %w", err)
	}
	return toDomainPrompt(&row), nil
}

// ListByOwner —— used by the admin /admin/prompts list + looked up when a
// visitor session is issued.
func (r *PromptRepo) ListByOwner(ctx context.Context, ownerID string) ([]entity.Prompt, error) {
	ownerUUID, oerr := pgstore.ParseUUID(ownerID)
	if oerr != nil {
		return nil, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, oerr)
	}
	rows, err := db.New(r.pool).ListPromptsByOwner(ctx, ownerUUID)
	if err != nil {
		return nil, fmt.Errorf("list prompts: %w", err)
	}
	out := make([]entity.Prompt, 0, len(rows))
	for i := range rows {
		out = append(out, toDomainPrompt(&rows[i]))
	}
	return out, nil
}

// GetByID —— a single prompt's details; verifies owner ownership.
func (r *PromptRepo) GetByID(ctx context.Context, ownerID, promptID string) (entity.Prompt, error) {
	args, perr := parsePromptIDArgs(ownerID, promptID)
	if perr != nil {
		return entity.Prompt{}, perr
	}
	row, err := db.New(r.pool).GetPromptByID(ctx, db.GetPromptByIDParams{
		ID: args.promptUUID, OwnerID: args.ownerUUID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return entity.Prompt{}, entity.ErrPromptNotFound
		}
		return entity.Prompt{}, fmt.Errorf("get prompt: %w", err)
	}
	return toDomainPrompt(&row), nil
}

// GetByName —— used by SeedPublicRole: upsert the public prompt first,
// then get its id for a Role to reference.
func (r *PromptRepo) GetByName(ctx context.Context, ownerID, name string) (entity.Prompt, error) {
	ownerUUID, oerr := pgstore.ParseUUID(ownerID)
	if oerr != nil {
		return entity.Prompt{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, oerr)
	}
	row, err := db.New(r.pool).GetPromptByName(ctx, db.GetPromptByNameParams{
		OwnerID: ownerUUID, Name: name,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return entity.Prompt{}, entity.ErrPromptNotFound
		}
		return entity.Prompt{}, fmt.Errorf("get prompt by name: %w", err)
	}
	return toDomainPrompt(&row), nil
}

// UpdatePromptInput —— Update's input.
type UpdatePromptInput struct {
	OwnerID     string
	PromptID    string
	Name        string
	Description string
	Body        string
}

// Update changes a prompt. A builtin prompt can have body / description
// changed but not be renamed — that check is caught by usecase (usecase
// calls GetByID, checks IsBuiltin + a Name diff → translates to
// ErrPromptBuiltinImmutable). repo here only translates unique conflicts.
func (r *PromptRepo) Update(ctx context.Context, in *UpdatePromptInput) (entity.Prompt, error) {
	args, perr := parsePromptIDArgs(in.OwnerID, in.PromptID)
	if perr != nil {
		return entity.Prompt{}, perr
	}
	row, err := db.New(r.pool).UpdatePrompt(ctx, db.UpdatePromptParams{
		ID: args.promptUUID, OwnerID: args.ownerUUID,
		Name: in.Name, Description: in.Description, Body: in.Body,
	})
	if err != nil {
		return entity.Prompt{}, mapPromptUpdateErr(err)
	}
	return toDomainPrompt(&row), nil
}

// mapPromptUpdateErr —— pulled out separately to lower Update's cyclomatic
// complexity.
func mapPromptUpdateErr(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return entity.ErrPromptNotFound
	}
	if name, hit := pgstore.UniqueViolation(err); hit && name == "prompts_owner_name_uniq" {
		return entity.ErrPromptNameTaken
	}
	return fmt.Errorf("update prompt: %w", err)
}

// Delete only deletes non-builtin prompts (the SQL predicate already locks
// this). A delete request against a builtin will DELETE 0 rows, and this
// doesn't return an error — the usecase layer already checked IsBuiltin
// via GetByID and blocked it before reaching repo.
func (r *PromptRepo) Delete(ctx context.Context, ownerID, promptID string) error {
	args, perr := parsePromptIDArgs(ownerID, promptID)
	if perr != nil {
		return perr
	}
	if err := db.New(r.pool).DeletePrompt(ctx, db.DeletePromptParams{
		ID: args.promptUUID, OwnerID: args.ownerUUID,
	}); err != nil {
		return fmt.Errorf("delete prompt: %w", err)
	}
	return nil
}

type promptIDArgs struct {
	promptUUID pgtype.UUID
	ownerUUID  pgtype.UUID
}

func parsePromptIDArgs(ownerID, promptID string) (promptIDArgs, error) {
	ownerUUID, oerr := pgstore.ParseUUID(ownerID)
	if oerr != nil {
		return promptIDArgs{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, oerr)
	}
	promptUUID, perr := pgstore.ParseUUID(promptID)
	if perr != nil {
		return promptIDArgs{}, fmt.Errorf("parse prompt id: %w", perr)
	}
	return promptIDArgs{ownerUUID: ownerUUID, promptUUID: promptUUID}, nil
}

func toDomainPrompt(row *db.Prompt) entity.Prompt {
	return entity.NewPrompt(&entity.PromptInit{
		ID: pgstore.FormatUUID(row.ID), OwnerID: pgstore.FormatUUID(row.OwnerID),
		Name: row.Name, Body: row.Body, Description: row.Description,
		IsBuiltin: row.IsBuiltin,
		CreatedAt: row.CreatedAt.Time, UpdatedAt: row.UpdatedAt.Time,
	})
}
