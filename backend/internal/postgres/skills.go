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

// SetCodeSkills —— InviteCode ↔ Skill 关联：clear + bulk insert。caller 持
// 已 validate 过的 skill_ids（确认属于同 owner）。空列表 → 只 clear。
func (r *SkillRepo) SetCodeSkills(
	ctx context.Context, codeID string, skillIDs []string,
) error {
	codeUUID, perr := parseUUID(codeID)
	if perr != nil {
		return fmt.Errorf(errParseCodeIDPrefix, perr)
	}
	q := dbq.New(r.pool)
	if cerr := q.ClearCodeSkills(ctx, codeUUID); cerr != nil {
		return fmt.Errorf("clear code skills: %w", cerr)
	}
	if len(skillIDs) == 0 {
		return nil
	}
	return attachCodeSkills(ctx, q, codeUUID, skillIDs)
}

func attachCodeSkills(
	ctx context.Context, q *dbq.Queries, codeUUID pgtype.UUID, skillIDs []string,
) error {
	skillUUIDs, suerr := parseUUIDArray(skillIDs)
	if suerr != nil {
		return fmt.Errorf("parse skill ids: %w", suerr)
	}
	if aerr := q.AttachCodeSkills(ctx, dbq.AttachCodeSkillsParams{
		CodeID: codeUUID, Column2: skillUUIDs,
	}); aerr != nil {
		return fmt.Errorf("attach code skills: %w", aerr)
	}
	return nil
}

// ListSkillIDsForCode —— admin codes 视图回显用。
func (r *SkillRepo) ListSkillIDsForCode(ctx context.Context, codeID string) ([]string, error) {
	codeUUID, perr := parseUUID(codeID)
	if perr != nil {
		return nil, fmt.Errorf(errParseCodeIDPrefix, perr)
	}
	rows, err := dbq.New(r.pool).ListSkillIDsForCode(ctx, codeUUID)
	if err != nil {
		return nil, fmt.Errorf("list code skill ids: %w", err)
	}
	out := make([]string, 0, len(rows))
	for _, r := range rows {
		out = append(out, formatUUID(r))
	}
	return out, nil
}

// ListSkillsForCode —— visitor session issue 时拿 skill 列表拼 prompt。
func (r *SkillRepo) ListSkillsForCode(ctx context.Context, codeID string) ([]domain.Skill, error) {
	codeUUID, perr := parseUUID(codeID)
	if perr != nil {
		return nil, fmt.Errorf(errParseCodeIDPrefix, perr)
	}
	rows, err := dbq.New(r.pool).ListSkillsForCode(ctx, codeUUID)
	if err != nil {
		return nil, fmt.Errorf("list skills for code: %w", err)
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
