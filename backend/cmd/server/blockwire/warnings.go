// warnings.go — the owner-facing read of persistent block-lifecycle warnings.
//
// The first (and today only) writer is uninstall-with-data (blockOps.uninstall → blockwarn.Raise):
// dropping a block that held records is permanent, so the owner sees a standing data-loss warning
// rather than losing the data silently. This exposes the read side as one owner op; the write side
// is internal to the delete path.

package blockwire

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/plugin/blockstore"
	"github.com/atmaxmoj/standmeet/internal/plugin/blockwarn"
	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

// warningsOut — the read shape. A named struct rather than map[string]any (any is banned in
// business code, and the shape is fixed).
type warningsOut struct {
	Warnings []blockwarn.Warning `json:"warnings"`
}

// WarningsResource — the "warnings" resource: list this owner's standing block-lifecycle warnings.
func WarningsResource(d *deps.Runtime) dispatcher.Resource {
	store := blockwarn.New(blockstore.New(d.DB))
	return dispatcher.Resource{Name: "warnings", Ops: []fp.Op{
		{
			ID: "warnings.list",
			Description: "List standing block-lifecycle warnings for the owner — e.g. a block " +
				"that held data was uninstalled and its records were permanently dropped.",
			InputSchema: fp.NoArgs,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      listWarnings(store),
		},
	}}
}

func listWarnings(store *blockwarn.Store) fp.Invoke {
	return func(ctx context.Context, ownerID string, _ json.RawMessage) (json.RawMessage, error) {
		ws, err := store.List(ctx, ownerID)
		if err != nil {
			return nil, fmt.Errorf("list warnings: %w", err)
		}
		return json.Marshal(warningsOut{Warnings: ws})
	}
}
