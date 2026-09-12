// code_denials.go —— reads and writes the code-level ACL denies (block-acl-hierarchy.md).
// Pure deny sparse tables; the handler checks the code belongs to this owner first, so this
// layer only reads/writes by code_id.

package repo

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/access/db"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// CodeDenialRepo —— CRUD for code_block_denials / code_skill_denials.
type CodeDenialRepo struct {
	pool *pgstore.Pool
}

// NewCodeDenialRepo constructs a CodeDenialRepo.
func NewCodeDenialRepo(pool *pgstore.Pool) *CodeDenialRepo { return &CodeDenialRepo{pool: pool} }

// ListBlocks —— the set of block ids this code denies (no rows =
// fully inherits the role).
func (r *CodeDenialRepo) ListBlocks(ctx context.Context, codeID string) ([]string, error) {
	id, err := pgstore.ParseUUID(codeID)
	if err != nil {
		return nil, fmt.Errorf(errParseCodeIDPrefix, err)
	}
	ids, qerr := db.New(r.pool).ListCodeBlockDenials(ctx, id)
	if qerr != nil {
		return nil, fmt.Errorf("list code block denials: %w", qerr)
	}
	return ids, nil
}

// ListSkills —— the set of skill ids this code denies.
func (r *CodeDenialRepo) ListSkills(ctx context.Context, codeID string) ([]string, error) {
	id, err := pgstore.ParseUUID(codeID)
	if err != nil {
		return nil, fmt.Errorf(errParseCodeIDPrefix, err)
	}
	rows, qerr := db.New(r.pool).ListCodeSkillDenials(ctx, id)
	if qerr != nil {
		return nil, fmt.Errorf("list code skill denials: %w", qerr)
	}
	return pgstore.UUIDStrings(rows), nil
}

// AddBlock —— denies one block (idempotent, PK conflict does DO NOTHING).
func (r *CodeDenialRepo) AddBlock(ctx context.Context, codeID, blockID string) error {
	id, err := pgstore.ParseUUID(codeID)
	if err != nil {
		return fmt.Errorf(errParseCodeIDPrefix, err)
	}
	if aerr := db.New(r.pool).AddCodeBlockDenial(ctx, db.AddCodeBlockDenialParams{
		CodeID: id, BlockID: blockID,
	}); aerr != nil {
		return fmt.Errorf("add code block denial: %w", aerr)
	}
	return nil
}

// DeleteBlock —— revokes one block deny (idempotent, no error even
// with zero rows).
func (r *CodeDenialRepo) DeleteBlock(ctx context.Context, codeID, blockID string) error {
	id, err := pgstore.ParseUUID(codeID)
	if err != nil {
		return fmt.Errorf(errParseCodeIDPrefix, err)
	}
	if derr := db.New(r.pool).DeleteCodeBlockDenial(ctx, db.DeleteCodeBlockDenialParams{
		CodeID: id, BlockID: blockID,
	}); derr != nil {
		return fmt.Errorf("delete code block denial: %w", derr)
	}
	return nil
}

// AddSkill —— denies one skill (idempotent).
func (r *CodeDenialRepo) AddSkill(ctx context.Context, codeID, skillID string) error {
	cid, err := pgstore.ParseUUID(codeID)
	if err != nil {
		return fmt.Errorf(errParseCodeIDPrefix, err)
	}
	sid, serr := pgstore.ParseUUID(skillID)
	if serr != nil {
		return fmt.Errorf("parse skill id: %w", serr)
	}
	if aerr := db.New(r.pool).AddCodeSkillDenial(ctx, db.AddCodeSkillDenialParams{
		CodeID: cid, SkillID: sid,
	}); aerr != nil {
		return fmt.Errorf("add code skill denial: %w", aerr)
	}
	return nil
}

// DeleteSkill —— revokes one skill deny (idempotent).
func (r *CodeDenialRepo) DeleteSkill(ctx context.Context, codeID, skillID string) error {
	cid, err := pgstore.ParseUUID(codeID)
	if err != nil {
		return fmt.Errorf(errParseCodeIDPrefix, err)
	}
	sid, serr := pgstore.ParseUUID(skillID)
	if serr != nil {
		return fmt.Errorf("parse skill id: %w", serr)
	}
	if derr := db.New(r.pool).DeleteCodeSkillDenial(ctx, db.DeleteCodeSkillDenialParams{
		CodeID: cid, SkillID: sid,
	}); derr != nil {
		return fmt.Errorf("delete code skill denial: %w", derr)
	}
	return nil
}

// ListCorpusURIs —— the set of corpus URI globs this code revokes (no rows =
// fully inherits the role's allow-list).
// The third of the ACL's three tiers: block/skill are deny-sets of discrete
// ids, corpus is a deny-set of globs — both are pure subtraction.
func (r *CodeDenialRepo) ListCorpusURIs(ctx context.Context, codeID string) ([]string, error) {
	id, err := pgstore.ParseUUID(codeID)
	if err != nil {
		return []string{}, fmt.Errorf(errParseCodeIDPrefix, err)
	}
	pats, qerr := db.New(r.pool).ListCodeCorpusDenials(ctx, id)
	if qerr != nil {
		return []string{}, fmt.Errorf("list code corpus denials: %w", qerr)
	}
	return pats, nil
}

// SetCorpusURIs —— fully replaces this code's corpus deny set (empty = fully
// inherits the role).
func (r *CodeDenialRepo) SetCorpusURIs(
	ctx context.Context, codeID string, patterns []string,
) error {
	id, err := pgstore.ParseUUID(codeID)
	if err != nil {
		return fmt.Errorf(errParseCodeIDPrefix, err)
	}
	q := db.New(r.pool)
	if cerr := q.ClearCodeCorpusDenials(ctx, id); cerr != nil {
		return fmt.Errorf("clear code corpus denials: %w", cerr)
	}
	for _, p := range patterns {
		if aerr := q.AttachCodeCorpusDenial(ctx, db.AttachCodeCorpusDenialParams{
			CodeID: id, UriPattern: p,
		}); aerr != nil {
			return fmt.Errorf("attach code corpus denial: %w", aerr)
		}
	}
	return nil
}
