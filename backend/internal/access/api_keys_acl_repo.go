// api_keys_acl.go —— per-key deny rows + the candidacy ("open") gate for the API-key facade.
// Denials mirror CodeDenialRepo (pure subtraction from the assumed role); open is owner-scoped.

package access

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/access/db"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// ───── per-key denials (mirror CodeDenialRepo) ─────

// ListCapabilityDenials —— capability ids denied on this key.
func (r *APIKeyRepo) ListCapabilityDenials(ctx context.Context, keyID string) ([]string, error) {
	keyUUID, err := pgstore.ParseUUID(keyID)
	if err != nil {
		return nil, fmt.Errorf(errParseKeyIDPrefix, err)
	}
	ids, qerr := db.New(r.pool).ListAPIKeyCapabilityDenials(ctx, keyUUID)
	if qerr != nil {
		return nil, fmt.Errorf("list api key capability denials: %w", qerr)
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

// AddCapabilityDenial —— deny a capability on this key (idempotent).
func (r *APIKeyRepo) AddCapabilityDenial(ctx context.Context, keyID, capabilityID string) error {
	keyUUID, err := pgstore.ParseUUID(keyID)
	if err != nil {
		return fmt.Errorf(errParseKeyIDPrefix, err)
	}
	if qerr := db.New(r.pool).AddAPIKeyCapabilityDenial(ctx, db.AddAPIKeyCapabilityDenialParams{
		KeyID: keyUUID, CapabilityID: capabilityID,
	}); qerr != nil {
		return fmt.Errorf("add api key capability denial: %w", qerr)
	}
	return nil
}

// DeleteCapabilityDenial —— lift a capability denial (idempotent).
func (r *APIKeyRepo) DeleteCapabilityDenial(ctx context.Context, keyID, capabilityID string) error {
	keyUUID, err := pgstore.ParseUUID(keyID)
	if err != nil {
		return fmt.Errorf(errParseKeyIDPrefix, err)
	}
	if qerr := db.New(r.pool).DeleteAPIKeyCapabilityDenial(
		ctx, db.DeleteAPIKeyCapabilityDenialParams{KeyID: keyUUID, CapabilityID: capabilityID},
	); qerr != nil {
		return fmt.Errorf("delete api key capability denial: %w", qerr)
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

// OpenCapability —— mark a capability as an API candidate for this owner (idempotent).
func (r *APIKeyRepo) OpenCapability(ctx context.Context, ownerID, capabilityID string) error {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	if qerr := db.New(r.pool).OpenAPICapability(ctx, db.OpenAPICapabilityParams{
		OwnerID: ownerUUID, CapabilityID: capabilityID,
	}); qerr != nil {
		return fmt.Errorf("open api capability: %w", qerr)
	}
	return nil
}

// CloseCapability —— withdraw an API candidate (idempotent). Keys whose role grants it stop
// reaching it immediately.
func (r *APIKeyRepo) CloseCapability(ctx context.Context, ownerID, capabilityID string) error {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	if qerr := db.New(r.pool).CloseAPICapability(ctx, db.CloseAPICapabilityParams{
		OwnerID: ownerUUID, CapabilityID: capabilityID,
	}); qerr != nil {
		return fmt.Errorf("close api capability: %w", qerr)
	}
	return nil
}

// ListOpenCapabilities —— the owner's opened (candidate) capability ids.
func (r *APIKeyRepo) ListOpenCapabilities(ctx context.Context, ownerID string) ([]string, error) {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	ids, qerr := db.New(r.pool).ListAPIOpenCapabilities(ctx, ownerUUID)
	if qerr != nil {
		return nil, fmt.Errorf("list api open capabilities: %w", qerr)
	}
	return ids, nil
}
