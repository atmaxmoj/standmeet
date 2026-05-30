// skills.go —— skills + code_skills CRUD。

package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/postgres/dbq"
)

// SkillRepo —— skills 表 + code_skills join 表 CRUD。
type SkillRepo struct {
	pool *Pool
}

// NewSkillRepo 构造 SkillRepo。
func NewSkillRepo(pool *Pool) *SkillRepo { return &SkillRepo{pool: pool} }

// CreateSkillInput —— Create 入参。owner-curated skill；scripts/metadata
// optional。字段顺序按 govet fieldalignment 排。
type CreateSkillInput struct {
	Metadata     map[string]string
	OwnerID      string
	Name         string
	Description  string
	Prompt       string
	Version      string
	License      string
	Source       string // 'manual' / 'import' / 'marketplace'
	AllowedTools []string
	Scripts      []domain.SkillScript
}

// Create 写一条 owner-curated skill。name 冲突翻 ErrSkillNameTaken。
func (r *SkillRepo) Create(ctx context.Context, in *CreateSkillInput) (domain.Skill, error) {
	params, perr := buildCreateSkillParams(in)
	if perr != nil {
		return domain.Skill{}, perr
	}
	row, err := dbq.New(r.pool).CreateSkill(ctx, *params)
	if err != nil {
		if name, hit := pgUniqueViolation(err); hit && name == "skills_owner_name_uniq" {
			return domain.Skill{}, domain.ErrSkillNameTaken
		}
		return domain.Skill{}, fmt.Errorf("create skill: %w", err)
	}
	return toDomainSkill(&row), nil
}

func buildCreateSkillParams(in *CreateSkillInput) (*dbq.CreateSkillParams, error) {
	ownerUUID, oerr := parseUUID(in.OwnerID)
	if oerr != nil {
		return nil, fmt.Errorf(errParseOwnerIDPrefix, oerr)
	}
	scripts, serr := json.Marshal(in.Scripts)
	if serr != nil {
		return nil, fmt.Errorf("marshal skill scripts: %w", serr)
	}
	meta, merr := json.Marshal(in.Metadata)
	if merr != nil {
		return nil, fmt.Errorf("marshal skill metadata: %w", merr)
	}
	source := in.Source
	if source == "" {
		source = "manual"
	}
	return &dbq.CreateSkillParams{
		OwnerID: ownerUUID, Name: in.Name, Description: in.Description, Prompt: in.Prompt,
		Scripts: scripts, Metadata: meta, AllowedTools: nilSafeTags(in.AllowedTools),
		IsBuiltin: false, Version: in.Version, License: in.License, Source: source,
	}, nil
}

// UpsertBuiltin —— seed builtin skills 用。idempotent by (owner_id, name)；
// description/prompt 字段会被新 seed 覆写让后续调整生效。
func (r *SkillRepo) UpsertBuiltin(
	ctx context.Context, ownerID, name, description, prompt string,
) (domain.Skill, error) {
	ownerUUID, oerr := parseUUID(ownerID)
	if oerr != nil {
		return domain.Skill{}, fmt.Errorf(errParseOwnerIDPrefix, oerr)
	}
	row, err := dbq.New(r.pool).UpsertBuiltinSkill(ctx, dbq.UpsertBuiltinSkillParams{
		OwnerID: ownerUUID, Name: name, Description: description, Prompt: prompt,
	})
	if err != nil {
		return domain.Skill{}, fmt.Errorf("upsert builtin skill: %w", err)
	}
	return toDomainSkill(&row), nil
}

// ListByOwner —— admin 列 owner 所有 skill (builtin 先，自定义后)。
func (r *SkillRepo) ListByOwner(ctx context.Context, ownerID string) ([]domain.Skill, error) {
	ownerUUID, oerr := parseUUID(ownerID)
	if oerr != nil {
		return nil, fmt.Errorf(errParseOwnerIDPrefix, oerr)
	}
	rows, err := dbq.New(r.pool).ListSkillsByOwner(ctx, ownerUUID)
	if err != nil {
		return nil, fmt.Errorf("list skills: %w", err)
	}
	out := make([]domain.Skill, 0, len(rows))
	for i := range rows {
		out = append(out, toDomainSkill(&rows[i]))
	}
	return out, nil
}

// Delete —— owner-curated skill 删除；builtin 不可删 (sqlc query 加了
// is_builtin=false 谓词，命中 0 行 → 返 ErrSkillBuiltinImmutable / NotFound)。
func (r *SkillRepo) Delete(ctx context.Context, ownerID, skillID string) error {
	args, perr := parseOwnerAndSkillID(ownerID, skillID)
	if perr != nil {
		return perr
	}
	if err := dbq.New(r.pool).DeleteSkill(ctx, dbq.DeleteSkillParams{
		ID: args.skillUUID, OwnerID: args.ownerUUID,
	}); err != nil {
		return fmt.Errorf("delete skill: %w", err)
	}
	return nil
}

type skillIDArgs struct {
	skillUUID pgtype.UUID
	ownerUUID pgtype.UUID
}

func parseOwnerAndSkillID(ownerID, skillID string) (skillIDArgs, error) {
	ownerUUID, oerr := parseUUID(ownerID)
	if oerr != nil {
		return skillIDArgs{}, fmt.Errorf(errParseOwnerIDPrefix, oerr)
	}
	skillUUID, perr := parseUUID(skillID)
	if perr != nil {
		return skillIDArgs{}, fmt.Errorf("parse skill id: %w", perr)
	}
	return skillIDArgs{ownerUUID: ownerUUID, skillUUID: skillUUID}, nil
}

// A.3-IAM-5: SetCodeSkills / ListSkillIDsForCode / ListSkillsForCode 都删了
// —— code_skills 表已 drop。Role 通过 role_skills 持 skill ids；
// ListSkillsForRole 是 RoleSnapshot 构造时唯一的 skill 列表来源。

// ListSkillsForRole —— RoleSnapshot 构造时拼 prompt / allowed_tools 用。
// 跟 ListSkillsForCode 同形态，dbq.ListRoleSkills 在 roles.sql 已声明。
func (r *SkillRepo) ListSkillsForRole(ctx context.Context, roleID string) ([]domain.Skill, error) {
	roleUUID, perr := parseUUID(roleID)
	if perr != nil {
		return nil, fmt.Errorf("parse role id: %w", perr)
	}
	rows, err := dbq.New(r.pool).ListRoleSkills(ctx, roleUUID)
	if err != nil {
		return nil, fmt.Errorf("list skills for role: %w", err)
	}
	out := make([]domain.Skill, 0, len(rows))
	for i := range rows {
		out = append(out, toDomainSkill(&rows[i]))
	}
	return out, nil
}

// GetByID —— admin / MCP get 单条。
func (r *SkillRepo) GetByID(ctx context.Context, ownerID, skillID string) (domain.Skill, error) {
	args, perr := parseOwnerAndSkillID(ownerID, skillID)
	if perr != nil {
		return domain.Skill{}, perr
	}
	row, err := dbq.New(r.pool).GetSkillByID(ctx, dbq.GetSkillByIDParams{
		ID: args.skillUUID, OwnerID: args.ownerUUID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Skill{}, domain.ErrSkillNotFound
		}
		return domain.Skill{}, fmt.Errorf("get skill: %w", err)
	}
	return toDomainSkill(&row), nil
}

func toDomainSkill(s *dbq.Skill) domain.Skill {
	out := domain.Skill{
		ID: formatUUID(s.ID), OwnerID: formatUUID(s.OwnerID),
		Name: s.Name, Description: s.Description, Prompt: s.Prompt,
		AllowedTools: s.AllowedTools, IsBuiltin: s.IsBuiltin,
		Version: s.Version, License: s.License, Source: s.Source,
		CreatedAt: s.CreatedAt.Time, UpdatedAt: s.UpdatedAt.Time,
		Scripts:  decodeSkillScripts(s.Scripts),
		Metadata: decodeSkillMetadata(s.Metadata),
	}
	return out
}

func decodeSkillScripts(raw []byte) []domain.SkillScript {
	if len(raw) == 0 {
		return []domain.SkillScript{}
	}
	var out []domain.SkillScript
	if err := json.Unmarshal(raw, &out); err != nil {
		return []domain.SkillScript{}
	}
	return out
}

func decodeSkillMetadata(raw []byte) map[string]string {
	if len(raw) == 0 {
		return map[string]string{}
	}
	var out map[string]string
	if err := json.Unmarshal(raw, &out); err != nil {
		return map[string]string{}
	}
	return out
}
