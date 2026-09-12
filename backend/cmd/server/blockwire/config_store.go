// config_store.go — how any block's settings get read and written (declared in config.go).
//
// This matches up two things: a block's **declaration** (the manifest's Config) and its
// **own isolated store**. It knows nothing beyond that — no field name is hard-coded, and adding
// a configurable field only needs one line in the manifest.

package blockwire

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/plugin"
	"github.com/atmaxmoj/standmeet/internal/plugin/blockconfig"
	"github.com/atmaxmoj/standmeet/internal/plugin/blockstore"
)

// configField — one setting's declaration + current value. Value / Default are JSON literals;
// when Overridden=false the two are equal.
// Field order follows pointer width — enforced by govet fieldalignment.
type configField struct {
	// Min / Max — the declared range, nil when the block declared none.
	//
	// Carried out to the panel because the panel renders BY TYPE and knows nothing
	// about any particular block: a number field's bounds can only come from the
	// declaration. Dropping them here is how a generic renderer quietly stops
	// enforcing a limit the block wrote down.
	Min         *int
	Max         *int
	Key         string
	Label       string
	Type        string
	Description string
	Value       string
	Default     string
	Overridden  bool
}

type blockConfigOps struct {
	store *blockstore.Store
}

// newBlockConfigOps — the settings side of the panel.
//
// The declarations are NOT snapshotted here. They used to be, read once out of
// `BuiltinManifests()` at boot, which was correct while every block shipped in the
// image. An owner can install a block now, and a block installed after boot would have
// had its settings form silently missing — the acceptance test's exact shape, since the
// fixture block it installs declares `config`. Read at call time from what registration
// noted instead (grants.go), so there is one answer to "which blocks are configurable"
// and it does not depend on when the question is asked.
func newBlockConfigOps(d *deps.Runtime) blockConfigOps {
	return blockConfigOps{store: blockstore.New(d.DB)}
}

func (blockConfigOps) Configurable(_ context.Context) []string {
	decls := configDecls()
	out := make([]string, 0, len(decls))
	for id := range decls {
		out = append(out, id)
	}
	// stable order: neither the panel nor golden files should depend on map iteration order
	slices.Sort(out)
	return out
}

func (a blockConfigOps) Get(ctx context.Context, ownerID, blockID string) ([]configField, error) {
	b, err := a.bind(blockID)
	if err != nil {
		return nil, err
	}
	fields, gerr := b.store.Get(ctx, ownerID, b.decl)
	if gerr != nil {
		return nil, fmt.Errorf("block config get: %w", gerr)
	}
	out := make([]configField, 0, len(fields))
	for i := range fields {
		// The range is joined from the DECLARATION rather than carried through
		// blockconfig.Field. That type answers "what is this set to", which is a
		// question about stored state; bounds are a question about the block, and
		// widening the storage type to carry them would put the manifest's vocabulary
		// inside the store.
		bnd := boundsOf(b.decl, fields[i].Key)
		out = append(out, configField{
			Key: fields[i].Key, Label: fields[i].Label, Type: fields[i].Type,
			Description: fields[i].Description, Value: fields[i].Value,
			Default: fields[i].Default, Overridden: fields[i].Overridden,
			Min: bnd.Min, Max: bnd.Max,
		})
	}
	return out, nil
}

// boundsOf — one field's declared range, or a zero bounds when it declared none.
//
// A struct rather than two bare *int returns: "min" and "max" are the same shape, so a
// caller that swapped them at the call site would compile and silently invert every range
// check on the panel.
type bounds struct{ Min, Max *int }

func boundsOf(decl []plugin.ConfigField, key string) bounds {
	for i := range decl {
		if decl[i].Key == key {
			return bounds{Min: decl[i].Min, Max: decl[i].Max}
		}
	}
	return bounds{}
}

func (a blockConfigOps) Set(
	ctx context.Context, ownerID, blockID string, values map[string]json.RawMessage,
) error {
	b, err := a.bind(blockID)
	if err != nil {
		return err
	}
	if serr := b.store.Set(ctx, ownerID, b.decl, values); serr != nil {
		if isBlockConfigCallerErr(serr) {
			return fp.BadInput(serr.Error())
		}
		return fmt.Errorf("block config set: %w", serr)
	}
	return nil
}

// isBlockConfigCallerErr — both classes mean "what the panel sent is wrong", not a server fault.
func isBlockConfigCallerErr(err error) bool {
	return errors.Is(err, blockconfig.ErrUnknownField) ||
		errors.Is(err, blockconfig.ErrInvalidValue)
}

// boundConfig — one block's declaration + storage bound to its own namespace.
type boundConfig struct {
	store *blockconfig.Store
	decl  []plugin.ConfigField
}

// bind — resolves blockID into its declaration + storage.
// An id with no config ever declared is treated as "not found" — not "config is empty".
func (a blockConfigOps) bind(blockID string) (boundConfig, error) {
	decl, ok := configDecls()[blockID]
	if !ok {
		return boundConfig{}, fp.NotFound("no such configurable block: " + blockID)
	}
	return boundConfig{
		decl: decl, store: blockconfig.New(a.store, blockstore.KindMCP, blockID),
	}, nil
}
