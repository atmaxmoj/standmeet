// boot_wireup_diag.go — wires the connector axis's invoke-by-id into the diag route,
// and translates its errors here.
//
// The translation lives in the composition root so `internal/routes/sys` doesn't have
// to import the connector package: the only thing that route needs to distinguish is
// "wrong address" (404) from "the thing didn't happen" (200 + ok:false); it expresses
// that with its own sentinel, and this file maps the connector-side error onto it.

package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"

	"github.com/atmaxmoj/standmeet/internal/connector"
	sysroutes "github.com/atmaxmoj/standmeet/internal/routes/sys"
)

func diagCategoryInvoke(d *deps.Runtime) sysroutes.CategoryInvokeFn {
	return func(
		ctx context.Context, ownerID, id, category, verb string, args json.RawMessage,
	) (json.RawMessage, error) {
		out, err := d.ConnectorSlots.InvokeByID(ctx, &connector.InvokeByIDInput{
			OwnerID: ownerID, ID: id, Category: category, Verb: verb, Args: args,
		})
		if errors.Is(err, connector.ErrNotFound) {
			return nil, sysroutes.ErrConnectorNotFound
		}
		if err != nil {
			return nil, fmt.Errorf("diag invoke %s.%s: %w", category, verb, err)
		}
		return out, nil
	}
}
