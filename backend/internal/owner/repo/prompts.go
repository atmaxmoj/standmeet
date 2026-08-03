// prompts.go —— prompts 表 CRUD。owner-scoped persona library。
//
// 设计 [[iam-role-pivot-plan]]：public（is_builtin=true）由 SeedPublicRole
// 在 owner claim 时 upsert 种入；删除被 repo 层挡（ErrPromptBuiltinImmutable）。

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

// PromptRepo —— prompts 表 CRUD。
type PromptRepo struct {
	pool *pgstore.Pool
}

// NewPromptRepo 构造。
func NewPromptRepo(pool *pgstore.Pool) *PromptRepo { return &PromptRepo{pool: pool} }

// CreatePromptInput —— Create 入参。
type CreatePromptInput struct {
	OwnerID     string
	Name        string
	Description string
	Body        string
}

// Create 新建 prompt。name 冲突翻 ErrPromptNameTaken。
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

// UpsertBuiltin —— SeedPublicRole 用。同 (owner_id, name) 覆盖 description / body。
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

// ListByOwner —— admin /admin/prompts 列表 + visitor session issue 时 lookup。
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

// GetByID —— 单条详情；属于 owner 校验。
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

// GetByName —— SeedPublicRole 用：public prompt 先 upsert 再 get id 给 Role 引用。
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

// UpdatePromptInput —— Update 入参。
type UpdatePromptInput struct {
	OwnerID     string
	PromptID    string
	Name        string
	Description string
	Body        string
}

// Update 改 prompt。builtin 可以改 body / description 但不可 rename —— 这层
// 检查由 usecase 拦（usecase 调 GetByID 看 IsBuiltin + Name diff → 翻 ErrPromptBuiltinImmutable）。
// repo 这里只翻 unique 冲突。
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

// mapPromptUpdateErr —— 单独抽出来降 Update 的 cyclomatic complexity。
func mapPromptUpdateErr(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return entity.ErrPromptNotFound
	}
	if name, hit := pgstore.UniqueViolation(err); hit && name == "prompts_owner_name_uniq" {
		return entity.ErrPromptNameTaken
	}
	return fmt.Errorf("update prompt: %w", err)
}

// Delete —— 只删 non-builtin（SQL 谓词已锁）。builtin 删请求会 DELETE 0 行，
// 这里不返 error —— usecase 层先 GetByID 看 IsBuiltin 校验，挡在 repo 之前。
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
