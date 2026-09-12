// boot_wireup_diag.go — wires invoke-by-id into the diag route, and translates its
// errors here.
//
// The translation lives in the composition root so `internal/routes/sys` doesn't have
// to import the plugin package: the only thing that route needs to distinguish is
// "wrong address" (404) from "the thing didn't happen" (200 + ok:false); it expresses
// that with its own sentinel, and this file maps the block-side error onto it.

package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"

	"github.com/atmaxmoj/standmeet/internal/plugin/adapters"
	sysroutes "github.com/atmaxmoj/standmeet/internal/routes/sys"
)

func diagSeamInvoke(d *deps.Runtime) sysroutes.SeamInvokeFn {
	return func(
		ctx context.Context, ownerID, id, seam, verb string, args json.RawMessage,
	) (json.RawMessage, error) {
		out, err := d.BlockDispatch.InvokeByID(ctx, &adapters.InvokeByIDInput{
			OwnerID: ownerID, ID: id, Seam: seam, Verb: verb, Args: args,
		})
		// Two ways to be at the wrong address, and the owner needs the same 404 for both:
		// no block goes by that id, and the block that does speaks a different seam.
		if errors.Is(err, adapters.ErrNotInstalled) ||
			errors.Is(err, adapters.ErrNoSupplier) ||
			errors.Is(err, adapters.ErrWrongSeam) {
			return nil, sysroutes.ErrSupplierNotFound
		}
		if err != nil {
			return nil, fmt.Errorf("diag invoke %s.%s: %w", seam, verb, err)
		}
		return out, nil
	}
}

// diagAgentCall — the by-id agent-op path, straight off the supplier table.
func diagAgentCall(d *deps.Runtime) sysroutes.AgentCallFn {
	return d.BlockSuppliers.AgentCall
}
