// microsites_takedown.go —— the "take it back down" family of microsite ops: rollback / unpublish /
// delete. Split out of microsites_authoring.go to keep both files under the per-file line cap.
// Shares this package's helpers (decodePageSlug, micrositeErr, toMicrositeOut, pageSlugSchema).

package ops

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
	"github.com/atmaxmoj/standmeet/internal/owner/usecase"
)

// micrositeTakedownOps —— rollback / unpublish / delete, appended to the authoring op list.
func micrositeTakedownOps(deps usecase.MicrositeDeps) []fp.Op {
	return []fp.Op{
		{
			ID: "microsite.rollback", Danger: fp.DangerWrite,
			Description: "Send live back to the previous build. No-op if there is none.",
			InputSchema: pageSlugSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      rollbackMicrosite(deps),
		},
		{
			ID: "microsite.unpublish", Danger: fp.DangerDestructive,
			Description: "Clear the live build so the page serves nothing. For the homepage this " +
				"reverts / to the built-in default; the draft is kept for re-publishing.",
			InputSchema: pageSlugSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      unpublishMicrosite(deps),
		},
		{
			ID: "microsite.delete", Danger: fp.DangerDestructive,
			Description: "Delete a microsite. It waits in the trash for 90 days with its builds " +
				"and store (microsite.restore brings it back), then it is purged.",
			InputSchema: pageSlugSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      deleteMicrosite(deps),
		},
		{
			ID: "microsite.trash",
			Description: "List deleted microsites still in the trash, newest first, with when " +
				"each was deleted and when it will be purged. Restore one by id.",
			InputSchema: json.RawMessage(`{"type":"object","properties":{}}`),
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      trashedMicrosites(deps),
		},
		{
			ID: "microsite.restore", Danger: fp.DangerWrite,
			Description: "Restore a deleted microsite from the trash by id, with its builds " +
				"(live included) and its store. Refused while a live page uses its slug.",
			InputSchema: json.RawMessage(`{"type":"object","properties":{` +
				`"id":{"type":"string","description":"The page id, as microsite.trash lists it."}` +
				`},"required":["id"]}`),
			Kind:   fp.Action,
			Reach:  fp.OwnerAction(),
			Invoke: restoreMicrosite(deps),
		},
	}
}

type trashedPageOut struct {
	ID        string `json:"id"`
	Slug      string `json:"slug"`
	Title     string `json:"title"`
	DeletedAt string `json:"deleted_at"`
	PurgeAt   string `json:"purge_at"`
}

func trashedMicrosites(deps usecase.MicrositeDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, _ json.RawMessage) (json.RawMessage, error) {
		pages, err := usecase.TrashedPages(ctx, deps, ownerID)
		if err != nil {
			return nil, micrositeErr(err)
		}
		out := make([]trashedPageOut, 0, len(pages))
		for i := range pages {
			out = append(out, trashedPageView(&pages[i]))
		}
		return json.Marshal(map[string][]trashedPageOut{"items": out})
	}
}

func trashedPageView(p *entity.TrashedMicrosite) trashedPageOut {
	purge := p.DeletedAt.Add(entity.MicrositeTrashRetention)
	return trashedPageOut{
		ID: p.ID, Slug: p.Slug, Title: p.Title,
		DeletedAt: p.DeletedAt.UTC().Format(time.RFC3339),
		PurgeAt:   purge.UTC().Format(time.RFC3339),
	}
}

func restoreMicrosite(deps usecase.MicrositeDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		id, perr := decodeTrashID(raw)
		if perr != nil {
			return nil, perr
		}
		if err := usecase.RestorePage(ctx, deps, ownerID, id); err != nil {
			return nil, restoreErr(err)
		}
		return json.Marshal(map[string]bool{"restored": true})
	}
}

func decodeTrashID(raw json.RawMessage) (string, error) {
	var in struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(raw, &in); err != nil {
		return "", fp.BadInput("invalid arguments: " + err.Error())
	}
	return in.ID, fp.RequireArgs([2]string{"id", in.ID})
}

// restoreErr —— the slug refusal names the slug; the rest are the microsite errors.
func restoreErr(err error) error {
	if taken, ok := errors.AsType[*entity.SlugTakenError](err); ok {
		return fp.Coded(fp.Conflict(taken.Error()), "slug_taken")
	}
	return micrositeErr(err)
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
