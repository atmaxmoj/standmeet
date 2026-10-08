// asset_trash.go —— assets.trash / assets.restore: where assets.pool_delete puts a file, and the
// way back (declared in asset_pool.go).

package ops

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/atmaxmoj/standmeet/internal/corpus/entity"
	"github.com/atmaxmoj/standmeet/internal/corpus/usecase"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

func assetTrashOps(deps *usecase.Deps) []fp.Op {
	return []fp.Op{
		{
			ID: "assets.trash",
			Description: "List files deleted from your asset pool that are still in the trash, " +
				"newest first, with when each was deleted and when it will be purged.",
			InputSchema: json.RawMessage(`{"type":"object","properties":{}}`),
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      listAssetTrash(deps),
		},
		{
			ID: "assets.restore", Danger: fp.DangerWrite,
			Description: "Restore a file from the trash to your asset pool; it is served again.",
			InputSchema: assetIDSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      restoreAsset(deps),
		},
	}
}

type trashedAssetOut struct {
	AssetID          string `json:"asset_id"`
	OriginalFilename string `json:"original_filename"`
	DeletedAt        string `json:"deleted_at"`
	PurgeAt          string `json:"purge_at"`
}

func listAssetTrash(deps *usecase.Deps) fp.Invoke {
	return func(ctx context.Context, ownerID string, _ json.RawMessage) (json.RawMessage, error) {
		if !deps.HasMedia() {
			return nil, fp.OpErr("list asset trash", errNoMedia)
		}
		items, err := usecase.TrashedAssets(ctx, deps.Media.Assets, ownerID)
		if err != nil {
			return nil, fp.OpErr("list asset trash", err)
		}
		out := make([]trashedAssetOut, 0, len(items))
		for i := range items {
			at := items[i].DeletedAt
			out = append(out, trashedAssetOut{
				AssetID: items[i].ID, OriginalFilename: items[i].OriginalFilename,
				DeletedAt: at.UTC().Format(time.RFC3339),
				PurgeAt:   at.Add(entity.TrashRetention).UTC().Format(time.RFC3339),
			})
		}
		return json.Marshal(map[string][]trashedAssetOut{"items": out})
	}
}

func restoreAsset(deps *usecase.Deps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		args, perr := parseAssetID(raw)
		if perr != nil {
			return nil, perr
		}
		if !deps.HasMedia() {
			return nil, fp.OpErr("restore asset", errNoMedia)
		}
		if err := usecase.RestoreAsset(ctx, deps.Media.Assets, ownerID, args.AssetID); err != nil {
			return nil, restoreAssetErr(err)
		}
		return json.RawMessage(`{"restored":true}`), nil
	}
}

func restoreAssetErr(err error) error {
	if errors.Is(err, entity.ErrAssetNotInTrash) {
		return fp.Coded(fp.NotFound("this file is not in the trash"), "not_in_trash")
	}
	return fp.OpErr("restore asset", err)
}
