// monitoring.go —— the owner's traffic-collection master switch (monitor.md §8).
// admin UI PUT /api/admin/monitoring lands here. Write the bool + return the updated settings
// (the same envelope byoai returns, so the frontend can swap the response into its /me cache).

package usecase

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
	"github.com/atmaxmoj/standmeet/internal/owner/repo"
)

// MonitoringDeps — repo SetMonitoringEnabled + GetSettings need (owners package).
type MonitoringDeps struct {
	Owners *repo.Repo
}

// UpdateMonitoring writes monitoring_enabled and returns the new Settings (the settings facet of
// the aggregate, no identity). A missing owner_id returns ErrEmptyField (the handler maps to 401).
func UpdateMonitoring(
	ctx context.Context, deps MonitoringDeps, ownerID string, enabled bool,
) (entity.Settings, error) {
	if ownerID == "" {
		return entity.Settings{}, apierr.ErrEmptyField
	}
	if err := deps.Owners.SetMonitoringEnabled(ctx, ownerID, enabled); err != nil {
		return entity.Settings{}, fmt.Errorf("update monitoring_enabled: %w", err)
	}
	s, err := deps.Owners.GetSettings(ctx, ownerID)
	if err != nil {
		return entity.Settings{}, fmt.Errorf("read settings: %w", err)
	}
	return s, nil
}
