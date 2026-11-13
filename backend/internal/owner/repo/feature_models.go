// feature_models.go —— reads and writes owner_feature_models: a model pinned per feature, with an
// optional role scope, overriding the resolved provider's own model while reusing its key (one
// Anthropic key serves haiku for visitor chat and sonnet for the interview cue). The durable layer
// over access_codes.model. The cascade (provider.model → feature global → role×feature →
// code.model) is read by FeatureModelFor; the call site applies code.model on top.

package repo

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/owner/db"
)

// FeatureModel —— one feature→model override. RoleID "" = the feature's global pin.
type FeatureModel struct {
	RoleID  string
	Feature string
	Model   string
}

// FeatureModelFor —— the model pinned for this owner's feature under roleID: the role's override if
// present, else the feature's global pin, else "" (the caller then keeps the resolved provider's
// own model). roleID "" asks for the global pin only. A missing row is "" not an error, so a
// best-effort read never fails the call that consults it.
func (r *Repo) FeatureModelFor(
	ctx context.Context, ownerID, roleID, feature string,
) (string, error) {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return "", fmt.Errorf(parseOwnerIDErrFmt, err)
	}
	model, qerr := db.New(r.pool).ResolveFeatureModel(ctx, db.ResolveFeatureModelParams{
		OwnerID: ownerUUID, RoleID: roleID, Feature: feature,
	})
	if errors.Is(qerr, pgx.ErrNoRows) {
		return "", nil
	}
	if qerr != nil {
		return "", fmt.Errorf("resolve feature model: %w", qerr)
	}
	return model, nil
}

// SetFeatureModel —— pin (or re-pin) the model for a feature. roleID "" pins the feature's global
// model; a role id pins that role's override of the feature.
func (r *Repo) SetFeatureModel(ctx context.Context, ownerID, roleID, feature, model string) error {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return fmt.Errorf(parseOwnerIDErrFmt, err)
	}
	if qerr := db.New(r.pool).SetFeatureModel(ctx, db.SetFeatureModelParams{
		OwnerID: ownerUUID, RoleID: roleID, Feature: feature, Model: model,
	}); qerr != nil {
		return fmt.Errorf("set feature model: %w", qerr)
	}
	return nil
}

// ClearFeatureModel —— drop one feature override (back to the layer above it).
func (r *Repo) ClearFeatureModel(ctx context.Context, ownerID, roleID, feature string) error {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return fmt.Errorf(parseOwnerIDErrFmt, err)
	}
	if qerr := db.New(r.pool).DeleteFeatureModel(ctx, db.DeleteFeatureModelParams{
		OwnerID: ownerUUID, RoleID: roleID, Feature: feature,
	}); qerr != nil {
		return fmt.Errorf("clear feature model: %w", qerr)
	}
	return nil
}

// ListFeatureModels —— every feature override for this owner (global pins and role overrides both),
// in feature then role order.
func (r *Repo) ListFeatureModels(ctx context.Context, ownerID string) ([]FeatureModel, error) {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(parseOwnerIDErrFmt, err)
	}
	rows, qerr := db.New(r.pool).ListFeatureModels(ctx, ownerUUID)
	if qerr != nil {
		return nil, fmt.Errorf("list feature models: %w", qerr)
	}
	out := make([]FeatureModel, 0, len(rows))
	for _, row := range rows {
		out = append(out, FeatureModel{RoleID: row.RoleID, Feature: row.Feature, Model: row.Model})
	}
	return out, nil
}
