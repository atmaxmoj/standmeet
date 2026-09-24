// microsites_takedown.go —— the "take it back down" family of microsite ops: rollback / unpublish /
// delete. Split out of microsites_authoring.go to keep both files under the per-file line cap.
// Shares this package's helpers (decodePageSlug, micrositeErr, toMicrositeOut, pageSlugSchema).

package ops

import (
	"context"
	"encoding/json"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/owner/usecase"
)

// micrositeTakedownOps —— rollback / unpublish / delete, appended to the authoring op list.
func micrositeTakedownOps(deps usecase.MicrositeDeps) []fp.Op {
	return []fp.Op{
		{
			ID:          "microsite.rollback",
			Description: "Send live back to the previous build. No-op if there is none.",
			InputSchema: pageSlugSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      rollbackMicrosite(deps),
		},
		{
			ID: "microsite.unpublish",
			Description: "Clear the live build so the page serves nothing. For the homepage this " +
				"reverts / to the built-in default; the draft is kept for re-publishing.",
			InputSchema: pageSlugSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      unpublishMicrosite(deps),
		},
		{
			ID:          "microsite.delete",
			Description: "Delete a microsite.",
			InputSchema: pageSlugSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      deleteMicrosite(deps),
		},
	}
}

func rollbackMicrosite(deps usecase.MicrositeDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := decodePageSlug(raw)
		if perr != nil {
			return nil, perr
		}
		page, err := usecase.Rollback(ctx, deps, ownerID, in.Slug)
		if err != nil {
			return nil, micrositeErr(err)
		}
		return json.Marshal(toMicrositeOut(&page))
	}
}

func unpublishMicrosite(deps usecase.MicrositeDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := decodePageSlug(raw)
		if perr != nil {
			return nil, perr
		}
		page, err := usecase.Unpublish(ctx, deps, ownerID, in.Slug)
		if err != nil {
			return nil, micrositeErr(err)
		}
		return json.Marshal(toMicrositeOut(&page))
	}
}

func deleteMicrosite(deps usecase.MicrositeDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := decodePageSlug(raw)
		if perr != nil {
			return nil, perr
		}
		if err := usecase.DeletePage(ctx, deps, ownerID, in.Slug); err != nil {
			return nil, micrositeErr(err)
		}
		return json.Marshal(deletedPageOut{Slug: in.Slug, Deleted: true})
	}
}
