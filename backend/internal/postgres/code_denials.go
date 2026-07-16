// code_denials.go —— code 层 ACL deny 的读写（capability-acl-hierarchy.md）。
// 纯 deny 稀疏表；owner-scope 由 handler 先校验 code 属本 owner，这里只按 code_id 读写。

package postgres

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/postgres/dbq"
)

// CodeDenialRepo —— code_capability_denials / code_skill_denials CRUD。
type CodeDenialRepo struct {
	pool *Pool
}

// NewCodeDenialRepo 构造 CodeDenialRepo。
func NewCodeDenialRepo(pool *Pool) *CodeDenialRepo { return &CodeDenialRepo{pool: pool} }

// ListCapabilities —— 这张 code deny 掉的 capability id 集（无行 = 完全继承 role）。
func (r *CodeDenialRepo) ListCapabilities(ctx context.Context, codeID string) ([]string, error) {
	id, err := parseUUID(codeID)
	if err != nil {
		return nil, fmt.Errorf(errParseCodeIDPrefix, err)
	}
	ids, qerr := dbq.New(r.pool).ListCodeCapabilityDenials(ctx, id)
	if qerr != nil {
		return nil, fmt.Errorf("list code capability denials: %w", qerr)
	}
	return ids, nil
}

// ListSkills —— 这张 code deny 掉的 skill id 集。
func (r *CodeDenialRepo) ListSkills(ctx context.Context, codeID string) ([]string, error) {
	id, err := parseUUID(codeID)
	if err != nil {
		return nil, fmt.Errorf(errParseCodeIDPrefix, err)
	}
	rows, qerr := dbq.New(r.pool).ListCodeSkillDenials(ctx, id)
	if qerr != nil {
		return nil, fmt.Errorf("list code skill denials: %w", qerr)
	}
	return uuidStrings(rows), nil
}

// AddCapability —— deny 一个 capability（幂等，PK 冲突 DO NOTHING）。
func (r *CodeDenialRepo) AddCapability(ctx context.Context, codeID, capabilityID string) error {
	id, err := parseUUID(codeID)
	if err != nil {
		return fmt.Errorf(errParseCodeIDPrefix, err)
	}
	if aerr := dbq.New(r.pool).AddCodeCapabilityDenial(ctx, dbq.AddCodeCapabilityDenialParams{
		CodeID: id, CapabilityID: capabilityID,
	}); aerr != nil {
		return fmt.Errorf("add code capability denial: %w", aerr)
	}
	return nil
}

// DeleteCapability —— 撤销一个 capability deny（幂等，无行也不报错）。
func (r *CodeDenialRepo) DeleteCapability(ctx context.Context, codeID, capabilityID string) error {
	id, err := parseUUID(codeID)
	if err != nil {
		return fmt.Errorf(errParseCodeIDPrefix, err)
	}
	if derr := dbq.New(r.pool).DeleteCodeCapabilityDenial(ctx, dbq.DeleteCodeCapabilityDenialParams{
		CodeID: id, CapabilityID: capabilityID,
	}); derr != nil {
		return fmt.Errorf("delete code capability denial: %w", derr)
	}
	return nil
}

// AddSkill —— deny 一个 skill（幂等）。
func (r *CodeDenialRepo) AddSkill(ctx context.Context, codeID, skillID string) error {
	cid, err := parseUUID(codeID)
	if err != nil {
		return fmt.Errorf(errParseCodeIDPrefix, err)
	}
	sid, serr := parseUUID(skillID)
	if serr != nil {
		return fmt.Errorf("parse skill id: %w", serr)
	}
	if aerr := dbq.New(r.pool).AddCodeSkillDenial(ctx, dbq.AddCodeSkillDenialParams{
		CodeID: cid, SkillID: sid,
	}); aerr != nil {
		return fmt.Errorf("add code skill denial: %w", aerr)
	}
	return nil
}

// DeleteSkill —— 撤销一个 skill deny（幂等）。
func (r *CodeDenialRepo) DeleteSkill(ctx context.Context, codeID, skillID string) error {
	cid, err := parseUUID(codeID)
	if err != nil {
		return fmt.Errorf(errParseCodeIDPrefix, err)
	}
	sid, serr := parseUUID(skillID)
	if serr != nil {
		return fmt.Errorf("parse skill id: %w", serr)
	}
	if derr := dbq.New(r.pool).DeleteCodeSkillDenial(ctx, dbq.DeleteCodeSkillDenialParams{
		CodeID: cid, SkillID: sid,
	}); derr != nil {
		return fmt.Errorf("delete code skill denial: %w", derr)
	}
	return nil
}

// ListCorpusURIs —— 这张 code 收回的 corpus URI glob 集（无行 = 完全继承 role 的正列表）。
// ACL 三层的第三类：capability/skill 是离散 id 的 deny 集，corpus 是 glob 的 deny 集 —— 同为纯减法。
func (r *CodeDenialRepo) ListCorpusURIs(ctx context.Context, codeID string) ([]string, error) {
	id, err := parseUUID(codeID)
	if err != nil {
		return []string{}, fmt.Errorf(errParseCodeIDPrefix, err)
	}
	pats, qerr := dbq.New(r.pool).ListCodeCorpusDenials(ctx, id)
	if qerr != nil {
		return []string{}, fmt.Errorf("list code corpus denials: %w", qerr)
	}
	return pats, nil
}

// SetCorpusURIs —— 全量重设这张 code 的 corpus deny 集（空 = 完全继承 role）。
func (r *CodeDenialRepo) SetCorpusURIs(
	ctx context.Context, codeID string, patterns []string,
) error {
	id, err := parseUUID(codeID)
	if err != nil {
		return fmt.Errorf(errParseCodeIDPrefix, err)
	}
	q := dbq.New(r.pool)
	if cerr := q.ClearCodeCorpusDenials(ctx, id); cerr != nil {
		return fmt.Errorf("clear code corpus denials: %w", cerr)
	}
	for _, p := range patterns {
		if aerr := q.AttachCodeCorpusDenial(ctx, dbq.AttachCodeCorpusDenialParams{
			CodeID: id, UriPattern: p,
		}); aerr != nil {
			return fmt.Errorf("attach code corpus denial: %w", aerr)
		}
	}
	return nil
}
