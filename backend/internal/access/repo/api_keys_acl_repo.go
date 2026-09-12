// api_keys_acl.go —— per-key deny rows + the candidacy ("open") gate for the API-key facade.
// Denials mirror CodeDenialRepo (pure subtraction from the assumed role); open is owner-scoped.

package repo

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/access/db"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// ───── per-key denials (mirror CodeDenialRepo) ─────

// ListBlockDenials —— block ids denied on this key.
func (r *APIKeyRepo) ListBlockDenials(ctx context.Context, keyID string) ([]string, error) {
	keyUUID, err := pgstore.ParseUUID(keyID)
	if err != nil {
		return nil, fmt.Errorf(errParseKeyIDPrefix, err)
	}
	ids, qerr := db.New(r.pool).ListAPIKeyBlockDenials(ctx, keyUUID)
	if qerr != nil {
		return nil, fmt.Errorf("list api key block denials: %w", qerr)
	}
	return ids, nil
}

// ListSkillDenials —— skill ids denied on this key (as RFC-4122 strings).
func (r *APIKeyRepo) ListSkillDenials(ctx context.Context, keyID string) ([]string, error) {
	keyUUID, err := pgstore.ParseUUID(keyID)
	if err != nil {
		return nil, fmt.Errorf(errParseKeyIDPrefix, err)
	}
	rows, qerr := db.New(r.pool).ListAPIKeySkillDenials(ctx, keyUUID)
	if qerr != nil {
		return nil, fmt.Errorf("list api key skill denials: %w", qerr)
	}
	return pgstore.UUIDStrings(rows), nil
}

// AddBlockDenial —— deny a block on this key (idempotent).
func (r *APIKeyRepo) AddBlockDenial(ctx context.Context, keyID, blockID string) error {
	keyUUID, err := pgstore.ParseUUID(keyID)
	if err != nil {
		return fmt.Errorf(errParseKeyIDPrefix, err)
	}
	if qerr := db.New(r.pool).AddAPIKeyBlockDenial(ctx, db.AddAPIKeyBlockDenialParams{
		KeyID: keyUUID, BlockID: blockID,
	}); qerr != nil {
		return fmt.Errorf("add api key block denial: %w", qerr)
	}
	return nil
}

// DeleteBlockDenial —— lift a block denial (idempotent).
func (r *APIKeyRepo) DeleteBlockDenial(ctx context.Context, keyID, blockID string) error {
	keyUUID, err := pgstore.ParseUUID(keyID)
	if err != nil {
		return fmt.Errorf(errParseKeyIDPrefix, err)
	}
	if qerr := db.New(r.pool).DeleteAPIKeyBlockDenial(
		ctx, db.DeleteAPIKeyBlockDenialParams{KeyID: keyUUID, BlockID: blockID},
	); qerr != nil {
		return fmt.Errorf("delete api key block denial: %w", qerr)
	}
	return nil
}

// AddSkillDenial —— deny a skill on this key (idempotent).
func (r *APIKeyRepo) AddSkillDenial(ctx context.Context, keyID, skillID string) error {
	keyUUID, err := pgstore.ParseUUID(keyID)
	if err != nil {
		return fmt.Errorf(errParseKeyIDPrefix, err)
	}
	skillUUID, serr := pgstore.ParseUUID(skillID)
	if serr != nil {
		return fmt.Errorf("parse skill id: %w", serr)
	}
	if qerr := db.New(r.pool).AddAPIKeySkillDenial(ctx, db.AddAPIKeySkillDenialParams{
		KeyID: keyUUID, SkillID: skillUUID,
	}); qerr != nil {
		return fmt.Errorf("add api key skill denial: %w", qerr)
	}
	return nil
}

// DeleteSkillDenial —— lift a skill denial (idempotent).
func (r *APIKeyRepo) DeleteSkillDenial(ctx context.Context, keyID, skillID string) error {
	keyUUID, err := pgstore.ParseUUID(keyID)
	if err != nil {
		return fmt.Errorf(errParseKeyIDPrefix, err)
	}
	skillUUID, serr := pgstore.ParseUUID(skillID)
	if serr != nil {
		return fmt.Errorf("parse skill id: %w", serr)
	}
	if qerr := db.New(r.pool).DeleteAPIKeySkillDenial(ctx, db.DeleteAPIKeySkillDenialParams{
		KeyID: keyUUID, SkillID: skillUUID,
	}); qerr != nil {
		return fmt.Errorf("delete api key skill denial: %w", qerr)
	}
	return nil
}

// ───── candidacy ("open") gate ─────

// OpenBlock —— mark a block as an API candidate for this owner (idempotent).
func (r *APIKeyRepo) OpenBlock(ctx context.Context, ownerID, blockID string) error {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	if qerr := db.New(r.pool).OpenAPIBlock(ctx, db.OpenAPIBlockParams{
		OwnerID: ownerUUID, BlockID: blockID,
	}); qerr != nil {
		return fmt.Errorf("open api block: %w", qerr)
	}
	return nil
}

// CloseBlock —— withdraw an API candidate (idempotent). Keys whose role grants it stop
// reaching it immediately.
func (r *APIKeyRepo) CloseBlock(ctx context.Context, ownerID, blockID string) error {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	if qerr := db.New(r.pool).CloseAPIBlock(ctx, db.CloseAPIBlockParams{
		OwnerID: ownerUUID, BlockID: blockID,
	}); qerr != nil {
		return fmt.Errorf("close api block: %w", qerr)
	}
	return nil
}

// ListOpenBlocks —— the owner's opened (candidate) block ids.
func (r *APIKeyRepo) ListOpenBlocks(ctx context.Context, ownerID string) ([]string, error) {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	ids, qerr := db.New(r.pool).ListAPIOpenBlocks(ctx, ownerUUID)
	if qerr != nil {
		return nil, fmt.Errorf("list api open blocks: %w", qerr)
	}
	return ids, nil
}
