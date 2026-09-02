// config_store.go — how any capability's settings get read and written (declared in config.go).
//
// This matches up two things: a capability's **declaration** (the manifest's Config) and its
// **own isolated store**. It knows nothing beyond that — no field name is hard-coded, and adding
// a configurable field only needs one line in the manifest.

package axiscap

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"

	"github.com/atmaxmoj/standmeet/internal/capabilities/capconfig"
	"github.com/atmaxmoj/standmeet/internal/capabilities/capstore"
	"github.com/atmaxmoj/standmeet/internal/capabilities/mcpplugin"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

// configField — one setting's declaration + current value. Value / Default are JSON literals;
// when Overridden=false the two are equal.
type configField struct {
	Key         string
	Label       string
	Type        string
	Description string
	Value       string
	Default     string
	Overridden  bool
}

type capConfigOps struct {
	store *capstore.Store
	decls map[string][]mcpplugin.ConfigField
}

// newCapConfigOps — collects all Config declarations from the built-in capabilities' manifests.
// A capability with no Config declared never enters this table — so the panel never shows an
// empty settings page for it.
func newCapConfigOps(d *deps.Runtime) capConfigOps {
	decls := map[string][]mcpplugin.ConfigField{}
	manifests := BuiltinManifests()
	for i := range manifests {
		if len(manifests[i].Config) > 0 {
			decls[manifests[i].ID] = manifests[i].Config
		}
	}
	return capConfigOps{store: capstore.New(d.DB), decls: decls}
}

func (a capConfigOps) Configurable(_ context.Context) []string {
	out := make([]string, 0, len(a.decls))
	for id := range a.decls {
		out = append(out, id)
	}
	// stable order: neither the panel nor golden files should depend on map iteration order
	slices.Sort(out)
	return out
}

func (a capConfigOps) Get(ctx context.Context, ownerID, capID string) ([]configField, error) {
	b, err := a.bind(capID)
	if err != nil {
		return nil, err
	}
	fields, gerr := b.store.Get(ctx, ownerID, b.decl)
	if gerr != nil {
		return nil, fmt.Errorf("capability config get: %w", gerr)
	}
	out := make([]configField, 0, len(fields))
	for i := range fields {
		out = append(out, configField{
			Key: fields[i].Key, Label: fields[i].Label, Type: fields[i].Type,
			Description: fields[i].Description, Value: fields[i].Value,
			Default: fields[i].Default, Overridden: fields[i].Overridden,
		})
	}
	return out, nil
}

func (a capConfigOps) Set(
	ctx context.Context, ownerID, capID string, values map[string]json.RawMessage,
) error {
	b, err := a.bind(capID)
	if err != nil {
		return err
	}
	if serr := b.store.Set(ctx, ownerID, b.decl, values); serr != nil {
		if isCapConfigCallerErr(serr) {
			return fp.BadInput(serr.Error())
		}
		return fmt.Errorf("capability config set: %w", serr)
	}
	return nil
}

// isCapConfigCallerErr — both classes mean "what the panel sent is wrong", not a server fault.
func isCapConfigCallerErr(err error) bool {
	return errors.Is(err, capconfig.ErrUnknownField) || errors.Is(err, capconfig.ErrInvalidValue)
}

// boundConfig — one capability's declaration + storage bound to its own namespace.
type boundConfig struct {
	store *capconfig.Store
	decl  []mcpplugin.ConfigField
}

// bind — resolves capID into its declaration + storage.
// An id with no config ever declared is treated as "not found" — not "config is empty".
func (a capConfigOps) bind(capID string) (boundConfig, error) {
	decl, ok := a.decls[capID]
	if !ok {
		return boundConfig{}, fp.NotFound("no such configurable capability: " + capID)
	}
	return boundConfig{decl: decl, store: capconfig.New(a.store, capstore.KindMCP, capID)}, nil
}
