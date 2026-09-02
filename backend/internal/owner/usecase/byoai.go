// byoai.go — BYOAI settings update use case.
// admin UI PUT /api/admin/byoai lands here. Validate + write to DB + return the updated owner.

package usecase

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
	"github.com/atmaxmoj/standmeet/internal/owner/repo"
)

// BYOAIDeps — repo UpdateBYOAI needs (owners package).
type BYOAIDeps struct {
	Owners *repo.Repo
}

// UpdateBYOAIInputReq — PUT /api/admin/byoai input (owner_id comes from the session).
// Field order follows govet fieldalignment: strings first, slice right after, bool last.
type UpdateBYOAIInputReq struct {
	OwnerID   string
	Blurb     string
	Providers []string
	Enabled   bool
}

// UpdateBYOAI writes byoai_enabled / providers / blurb together and returns the new
// OwnerSettings (the settings facet of the aggregate, no identity).
// A missing owner_id returns ErrOwnerNotFound (the handler maps it to 401).
func UpdateBYOAI(
	ctx context.Context, deps BYOAIDeps, in *UpdateBYOAIInputReq,
) (entity.Settings, error) {
	if in.OwnerID == "" {
		return entity.Settings{}, apierr.ErrEmptyField
	}
	s, err := deps.Owners.UpdateBYOAI(ctx, &repo.UpdateBYOAIInput{
		OwnerID:   in.OwnerID,
		Enabled:   in.Enabled,
		Providers: in.Providers,
		Blurb:     in.Blurb,
	})
	if err != nil {
		return entity.Settings{}, fmt.Errorf("update byoai: %w", err)
	}
	return s, nil
}
