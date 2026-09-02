// skills.go — CRUD for skills + code_skills.

package repo

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/marketplace/db"
	"github.com/atmaxmoj/standmeet/internal/marketplace/entity"
)

// SkillRepo — CRUD for the skills table + the code_skills join table.
type SkillRepo struct {
	pool *pgstore.Pool
}

// NewSkillRepo constructs a SkillRepo.
func NewSkillRepo(pool *pgstore.Pool) *SkillRepo { return &SkillRepo{pool: pool} }

// CreateSkillInput — input for Create. An owner-curated skill; scripts/metadata
// are optional. Field order follows govet fieldalignment.
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
	Scripts      []entity.SkillScript
}

// Create writes one owner-curated skill. A name conflict maps to ErrSkillNameTaken.
func (r *SkillRepo) Create(ctx context.Context, in *CreateSkillInput) (entity.Skill, error) {
	params, perr := buildCreateSkillParams(in)
	if perr != nil {
		return entity.Skill{}, perr
	}
	row, err := db.New(r.pool).CreateSkill(ctx, *params)
	if err != nil {
		if name, hit := pgstore.UniqueViolation(err); hit && name == "skills_owner_name_uniq" {
			return entity.Skill{}, entity.ErrSkillNameTaken
		}
		return entity.Skill{}, fmt.Errorf("create skill: %w", err)
	}
	return toDomainSkill(&row), nil
}

func buildCreateSkillParams(in *CreateSkillInput) (*db.CreateSkillParams, error) {
	ownerUUID, oerr := pgstore.ParseUUID(in.OwnerID)
	if oerr != nil {
		return nil, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, oerr)
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
	return &db.CreateSkillParams{
		OwnerID: ownerUUID, Name: in.Name, Description: in.Description, Prompt: in.Prompt,
		Scripts: scripts, Metadata: meta, AllowedTools: pgstore.NilSafeStrings(in.AllowedTools),
		IsBuiltin: false, Version: in.Version, License: in.License, Source: source,
	}, nil
}

// UpsertBuiltin — used to seed builtin skills. Idempotent by (owner_id, name);
// the description/prompt fields get overwritten by each new seed, so later
// adjustments take effect.
func (r *SkillRepo) UpsertBuiltin(
	ctx context.Context, ownerID, name, description, prompt string,
) (entity.Skill, error) {
	ownerUUID, oerr := pgstore.ParseUUID(ownerID)
	if oerr != nil {
		return entity.Skill{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, oerr)
	}
	row, err := db.New(r.pool).UpsertBuiltinSkill(ctx, db.UpsertBuiltinSkillParams{
		OwnerID: ownerUUID, Name: name, Description: description, Prompt: prompt,
	})
	if err != nil {
		return entity.Skill{}, fmt.Errorf("upsert builtin skill: %w", err)
	}
	return toDomainSkill(&row), nil
}

// ListByOwner — admin lists every skill for an owner (builtins first, custom after).
func (r *SkillRepo) ListByOwner(ctx context.Context, ownerID string) ([]entity.Skill, error) {
	ownerUUID, oerr := pgstore.ParseUUID(ownerID)
	if oerr != nil {
		return nil, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, oerr)
	}
	rows, err := db.New(r.pool).ListSkillsByOwner(ctx, ownerUUID)
	if err != nil {
		return nil, fmt.Errorf("list skills: %w", err)
	}
	out := make([]entity.Skill, 0, len(rows))
	for i := range rows {
		out = append(out, toDomainSkill(&rows[i]))
	}
	return out, nil
}

// Delete — removes an owner-curated skill; builtins cannot be deleted (the
// sqlc query adds an is_builtin=false predicate, so a 0-row hit maps to
// ErrSkillBuiltinImmutable / NotFound).
func (r *SkillRepo) Delete(ctx context.Context, ownerID, skillID string) error {
	args, perr := parseOwnerAndSkillID(ownerID, skillID)
	if perr != nil {
		return perr
	}
	if err := db.New(r.pool).DeleteSkill(ctx, db.DeleteSkillParams{
		ID: args.skillUUID, OwnerID: args.ownerUUID,
	}); err != nil {
		return fmt.Errorf("delete skill: %w", err)
	}
	return nil
}

// UpdateSkillInput — input for Update. Field order follows govet fieldalignment.
type UpdateSkillInput struct {
	OwnerID      string
	SkillID      string
	Name         string
	Description  string
	Prompt       string
	AllowedTools []string
}

// Update — edits an owner's own skill (body + the tools it may call). Builtins
// cannot be edited (the query carries `is_builtin = false`) → 0 rows →
// ErrSkillBuiltinImmutable.
//
// This path used to **exist only at the sqlc layer, with zero callers** — so the
// design doc's promise that "prompt or allowed-tools can be edited after install"
// never had anywhere to land in the product, and an owner-supplied connector could
// only be invoked via a skill that declared its operation name (F-C-57).
func (r *SkillRepo) Update(ctx context.Context, in *UpdateSkillInput) (entity.Skill, error) {
	args, perr := parseOwnerAndSkillID(in.OwnerID, in.SkillID)
	if perr != nil {
		return entity.Skill{}, perr
	}
	row, err := db.New(r.pool).UpdateSkill(ctx, db.UpdateSkillParams{
		ID: args.skillUUID, OwnerID: args.ownerUUID,
		Name: in.Name, Description: in.Description, Prompt: in.Prompt,
		AllowedTools: pgstore.NilSafeStrings(in.AllowedTools),
	})
	if err != nil {
		return entity.Skill{}, updateSkillErr(err)
	}
	return toDomainSkill(&row), nil
}

// updateSkillErr — maps pg's two rejection shapes to this domain's sentinel
// errors. 0 rows means the predicate blocked a builtin.
func updateSkillErr(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return entity.ErrSkillBuiltinImmutable
	}
	if name, hit := pgstore.UniqueViolation(err); hit && name == "skills_owner_name_uniq" {
		return entity.ErrSkillNameTaken
	}
	return fmt.Errorf("update skill: %w", err)
}

type skillIDArgs struct {
	skillUUID pgtype.UUID
	ownerUUID pgtype.UUID
}

func parseOwnerAndSkillID(ownerID, skillID string) (skillIDArgs, error) {
	ownerUUID, oerr := pgstore.ParseUUID(ownerID)
	if oerr != nil {
		return skillIDArgs{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, oerr)
	}
	skillUUID, perr := pgstore.ParseUUID(skillID)
	if perr != nil {
		return skillIDArgs{}, fmt.Errorf("parse skill id: %w", perr)
	}
	return skillIDArgs{ownerUUID: ownerUUID, skillUUID: skillUUID}, nil
}

// A.3-IAM-5: SetCodeSkills / ListSkillIDsForCode / ListSkillsForCode were all
// removed — the code_skills table has been dropped. A Role holds skill ids via
// role_skills; ListSkillsForRole is the sole skill-list source when building a
// RoleSnapshot.

// ListSkillsForRole — used when building a RoleSnapshot to assemble
// prompt / allowed_tools. Same shape as ListSkillsForCode; db.ListRoleSkills is
// already declared in roles.sql.
func (r *SkillRepo) ListSkillsForRole(
	ctx context.Context, roleID string) ([]entity.Skill, error,
) {
	roleUUID, perr := pgstore.ParseUUID(roleID)
	if perr != nil {
		return nil, fmt.Errorf("parse role id: %w", perr)
	}
	rows, err := db.New(r.pool).ListRoleSkills(ctx, roleUUID)
	if err != nil {
		return nil, fmt.Errorf("list skills for role: %w", err)
	}
	out := make([]entity.Skill, 0, len(rows))
	for i := range rows {
		out = append(out, toDomainSkill(&rows[i]))
	}
	return out, nil
}

// GetByID — admin / MCP fetch a single row.
func (r *SkillRepo) GetByID(
	ctx context.Context, ownerID, skillID string) (entity.Skill, error,
) {
	args, perr := parseOwnerAndSkillID(ownerID, skillID)
	if perr != nil {
		return entity.Skill{}, perr
	}
	row, err := db.New(r.pool).GetSkillByID(ctx, db.GetSkillByIDParams{
		ID: args.skillUUID, OwnerID: args.ownerUUID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return entity.Skill{}, entity.ErrSkillNotFound
		}
		return entity.Skill{}, fmt.Errorf("get skill: %w", err)
	}
	return toDomainSkill(&row), nil
}

// SetEnabled — #48-2: owner globally enables/disables a skill.
func (r *SkillRepo) SetEnabled(
	ctx context.Context, ownerID, skillID string, enabled bool,
) (entity.Skill, error) {
	args, perr := parseOwnerAndSkillID(ownerID, skillID)
	if perr != nil {
		return entity.Skill{}, perr
	}
	row, err := db.New(r.pool).SetSkillEnabled(ctx, db.SetSkillEnabledParams{
		ID: args.skillUUID, OwnerID: args.ownerUUID, Enabled: enabled,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return entity.Skill{}, entity.ErrSkillNotFound
		}
		return entity.Skill{}, fmt.Errorf("set skill enabled: %w", err)
	}
	return toDomainSkill(&row), nil
}

func toDomainSkill(s *db.Skill) entity.Skill {
	out := entity.Skill{
		ID: pgstore.FormatUUID(s.ID), OwnerID: pgstore.FormatUUID(s.OwnerID),
		Name: s.Name, Description: s.Description, Prompt: s.Prompt,
		AllowedTools: s.AllowedTools, IsBuiltin: s.IsBuiltin, Enabled: s.Enabled,
		Version: s.Version, License: s.License, Source: s.Source,
		CreatedAt: s.CreatedAt.Time, UpdatedAt: s.UpdatedAt.Time,
		Scripts:  decodeSkillScripts(s.Scripts),
		Metadata: decodeSkillMetadata(s.Metadata),
	}
	return out
}

func decodeSkillScripts(raw []byte) []entity.SkillScript {
	if len(raw) == 0 {
		return []entity.SkillScript{}
	}
	var out []entity.SkillScript
	if err := json.Unmarshal(raw, &out); err != nil {
		return []entity.SkillScript{}
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
