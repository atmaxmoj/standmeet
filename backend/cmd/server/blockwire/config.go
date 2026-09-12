// config.go — resource block_config: the settings for **any** block, declared by
// the block itself.
//
// This is the generic slot the panel leaves open for blocks. A block declares its
// settings (key/type/default) in its own manifest; this layer reads and writes them generically
// — it doesn't know the meaning of any field, and doesn't know words like "booking" or
// "working_hours".
//
// It replaces "one hand-written route + form per block": booker's booking policy used to
// work that way — host hand-wrote the entity, defaults, read/write, routing, and form, and the
// sandbox side kept its own copy, and the two drifted. Once declarative, adding a configurable
// field = adding one line in the manifest; the panel and storage pick it up automatically.

package blockwire

import (
	"context"
	"encoding/json"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

// BlockConfigResource — list / get / set.
func BlockConfigResource(d *deps.Runtime) dispatcher.Resource {
	ops := newBlockConfigOps(d)
	return dispatcher.Resource{Name: "block_config", Ops: []fp.Op{
		{
			ID: "block_config.list",
			Description: "List the block ids that declare configurable settings. " +
				"A block with no declared settings never appears here.",
			InputSchema: fp.NoArgs,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      listConfigurable(ops),
		},
		{
			ID: "block_config.get",
			Description: "Read one block's settings: every field it declares, with the " +
				"value in effect and the declared default. Fields the owner never set report " +
				"the default and overridden=false.",
			InputSchema: blockConfigIDSchema,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      getBlockConfig(ops),
		},
		{
			ID: "block_config.set",
			Description: "Set one block's settings. Only keys the block declares are " +
				"accepted; anything else is rejected rather than stored and ignored.",
			InputSchema: blockConfigSetSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      setBlockConfig(ops),
		},
	}}
}

var (
	blockConfigIDSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"block_id":{"type":"string","description":"Block id, e.g. calendar.book."}
		},
		"required":["block_id"]
	}`)

	blockConfigSetSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"block_id":{"type":"string","description":"Block id, e.g. calendar.book."},
			"values":{"type":"object",
				"description":"Field key → new value. Keys must be declared by the block."}
		},
		"required":["block_id","values"]
	}`)
)

// configFieldOut / configOut — the outbound payload shape (same across every facade).
//
// Field order follows pointer width — enforced by govet fieldalignment.
type configFieldOut struct {
	Min         *int            `json:"min,omitempty"`
	Max         *int            `json:"max,omitempty"`
	Key         string          `json:"key"`
	Label       string          `json:"label"`
	Type        string          `json:"type"`
	Description string          `json:"description,omitempty"`
	Value       json.RawMessage `json:"value"`
	Default     json.RawMessage `json:"default"`
	Overridden  bool            `json:"overridden"`
}

type configOut struct {
	BlockID string           `json:"block_id"`
	Fields  []configFieldOut `json:"fields"`
}

type configurableOut struct {
	Blocks []string `json:"blocks"`
}

func toConfigOut(blockID string, fields []configField) configOut {
	out := make([]configFieldOut, 0, len(fields))
	for i := range fields {
		out = append(out, configFieldOut{
			Key: fields[i].Key, Label: fields[i].Label, Type: fields[i].Type,
			Description: fields[i].Description,
			Value:       json.RawMessage(fields[i].Value),
			Default:     json.RawMessage(fields[i].Default),
			Min:         fields[i].Min,
			Max:         fields[i].Max,
			Overridden:  fields[i].Overridden,
		})
	}
	return configOut{BlockID: blockID, Fields: out}
}

func listConfigurable(ops blockConfigOps) fp.Invoke {
	return func(ctx context.Context, _ string, _ json.RawMessage) (json.RawMessage, error) {
		return json.Marshal(configurableOut{Blocks: ops.Configurable(ctx)})
	}
}

// blockConfigTarget — names which block's config to read/write.
type blockConfigTarget struct {
	BlockID string `json:"block_id"`
}

func getBlockConfig(ops blockConfigOps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in blockConfigTarget
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, fp.BadInput("invalid arguments: " + err.Error())
		}
		if err := fp.RequireArgs([2]string{"block_id", in.BlockID}); err != nil {
			return nil, err
		}
		fields, err := ops.Get(ctx, ownerID, in.BlockID)
		if err != nil {
			return nil, err
		}
		return json.Marshal(toConfigOut(in.BlockID, fields))
	}
}

type blockConfigSetArgs struct {
	Values  map[string]json.RawMessage `json:"values"`
	BlockID string                     `json:"block_id"`
}

func decodeConfigSet(raw json.RawMessage) (blockConfigSetArgs, error) {
	var in blockConfigSetArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return in, fp.BadInput("invalid arguments: " + err.Error())
	}
	return in, fp.RequireArgs([2]string{"block_id", in.BlockID})
}

func setBlockConfig(ops blockConfigOps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := decodeConfigSet(raw)
		if perr != nil {
			return nil, perr
		}
		if err := ops.Set(ctx, ownerID, in.BlockID, in.Values); err != nil {
			return nil, err
		}
		fields, gerr := ops.Get(ctx, ownerID, in.BlockID)
		if gerr != nil {
			return nil, gerr
		}
		return json.Marshal(toConfigOut(in.BlockID, fields))
	}
}
