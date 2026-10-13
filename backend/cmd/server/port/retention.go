// retention.go —— the ephemeral clock's dependencies, built in one place: the bundle repo, the
// access domain's "revoke this page's codes" (with a reason), the outbox.

package port

import (
	"context"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"
	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
)

// Retention —— the clock's deps (docs/design/job-loop-retention.md).
func Retention(d *deps.Runtime) *owner.RetentionDeps {
	return &owner.RetentionDeps{
		Bundles: owner.NewRetentionRepo(d.DB),
		RevokePageCodes: func(ctx context.Context, ownerID, pageID, reason string) error {
			return access.RevokePageCodes(ctx, access.CodesDeps{
				Codes: d.CodeRepo, Roles: d.RoleRepo, Sessions: d.VisitorStore, Log: d.Log,
				Events: d.Recorder(),
			}, ownerID, pageID, reason)
		},
		Events: d.Recorder,
	}
}
