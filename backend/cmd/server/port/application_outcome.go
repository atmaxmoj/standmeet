// application_outcome.go —— the job loop's two narrow ports into the access domain (roadmap 1.4):
// what still opens an application's code, and revoking it.

package port

import (
	"context"
	"errors"
	"fmt"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"
	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsuc"
)

// CodeBound —— the embeds and the microsite bound to one code.
func CodeBound(
	d *deps.Runtime,
) func(ctx context.Context, ownerID, codeID string) (jobsuc.Bound, error) {
	return func(ctx context.Context, ownerID, codeID string) (jobsuc.Bound, error) {
		embeds, err := d.EmbedRepo.IDsByCode(ctx, ownerID, codeID)
		if err != nil {
			return jobsuc.Bound{}, fmt.Errorf("embeds by code: %w", err)
		}
		byID, err := d.CodeRepo.GetByID(ctx, codeID)
		if err != nil {
			return jobsuc.Bound{}, fmt.Errorf("code: %w", err)
		}
		sites, err := pageOf(ctx, d, byID.Code)
		return jobsuc.Bound{Embeds: embeds, Microsites: sites}, err
	}
}

// pageOf —— the page an active code opens. GetByCode is the read that joins the bound page's
// slug (the landing's read); a code already revoked opens none.
func pageOf(ctx context.Context, d *deps.Runtime, code string) ([]string, error) {
	c, err := d.CodeRepo.GetByCode(ctx, code)
	switch {
	case errors.Is(err, access.ErrCodeRevoked):
		return []string{}, nil
	case err != nil:
		return nil, fmt.Errorf("code page: %w", err)
	case c.MicrositeSlug == "":
		return []string{}, nil
	}
	return []string{c.MicrositeSlug}, nil
}

// RevokeCode —— revokes a code and ends its sessions, the same path as codes.revoke.
func RevokeCode(d *deps.Runtime) func(ctx context.Context, ownerID, codeID string) error {
	return func(ctx context.Context, ownerID, codeID string) error {
		err := access.RevokeCode(ctx, access.CodesDeps{
			Codes: d.CodeRepo, Roles: d.RoleRepo, Sessions: d.VisitorStore, Log: d.Log,
			Events: d.Recorder(),
		}, ownerID, codeID)
		if err != nil {
			return fmt.Errorf("revoke code: %w", err)
		}
		return nil
	}
}
