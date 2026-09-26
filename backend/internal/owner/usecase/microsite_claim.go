package usecase

import (
	"context"
	"fmt"
	"time"

	"github.com/atmaxmoj/standmeet/internal/owner/entity"
	"github.com/atmaxmoj/standmeet/internal/owner/repo"
)

// ClaimBuildForBuilder —— hand the next build to a builder, but only to a builder of this
// backend's own version. During an upgrade the old builder outlives the old backend by tens of
// seconds; given work, it built pages with the old SDK and marked them built (prod, 2026-09-26).
// A mismatch returns ErrBuilderVersionMismatch and claims nothing; the new builder takes the work.
func ClaimBuildForBuilder(
	ctx context.Context, builds *repo.MicrositeBuildRepo,
	builderVersion, backendVersion string, lease time.Duration,
) (entity.MicrositeBuild, error) {
	if builderVersion != backendVersion {
		return entity.MicrositeBuild{}, fmt.Errorf("%w: builder %q, backend %q",
			entity.ErrBuilderVersionMismatch, builderVersion, backendVersion)
	}
	build, err := builds.ClaimPending(ctx, lease)
	if err != nil {
		return entity.MicrositeBuild{}, fmt.Errorf("claim build: %w", err)
	}
	return build, nil
}
