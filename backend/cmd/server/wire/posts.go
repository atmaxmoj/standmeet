// posts.go —— the posts service (docs/design/posts.md), and the one port it needs from access:
// whether a post's audience names this owner's roles.

package wire

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"
	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
)

// Posts —— the service, over the runtime's pool, event recorder and asset repo.
func Posts(d *deps.Runtime) *corpus.PostsService {
	return corpus.NewPosts(&corpus.PostsDeps{
		Pool: d.DB, Events: d.Recorder(), Assets: d.AssetRepo,
		Roles: func(ctx context.Context, ownerID string, ids []string) error {
			for _, id := range ids {
				if _, err := d.RoleRepo.GetByID(ctx, ownerID, id); err != nil {
					return fmt.Errorf("no role %q", id)
				}
			}
			return nil
		},
	})
}
