// config.go — resource capability_config: the settings for **any** capability, declared by
// the capability axis itself.
//
// This is the generic slot the panel leaves open for capabilities. A capability declares its
// settings (key/type/default) in its own manifest; this layer reads and writes them generically
// — it doesn't know the meaning of any field, and doesn't know words like "booking" or
// "working_hours".
//
// It replaces "one hand-written route + form per capability": booker's booking policy used to
// work that way — host hand-wrote the entity, defaults, read/write, routing, and form, and the
// sandbox side kept its own copy, and the two drifted. Once declarative, adding a configurable
// field = adding one line in the manifest; the panel and storage pick it up automatically.

package axiscap

import (
	"context"
	"encoding/json"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

// CapabilityConfigResource — list / get / set.
func CapabilityConfigResource(d *deps.Runtime) dispatcher.Resource {
	ops := newCapConfigOps(d)
	return dispatcher.Resource{Name: "capability_config", Ops: []fp.Op{
		{
			ID: "capability_config.list",
			Description: "List the capability ids that declare configurable settings. " +
				"A capability with no declared settings never appears here.",
			InputSchema: fp.NoArgs,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      listConfigurable(ops),
		},
		{
			ID: "capability_config.get",
			Description: "Read one capability's settings: every field it declares, with the " +
				"value in effect and the declared default. Fields the owner never set report " +
				"the default and overridden=false.",
			InputSchema: capabilityConfigIDSchema,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      getCapabilityConfig(ops),
		},
		{
			ID: "capability_config.set",
			Description: "Set one capability's settings. Only keys the capability declares are " +
				"accepted; anything else is rejected rather than stored and ignored.",
			InputSchema: capabilityConfigSetSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      setCapabilityConfig(ops),
		},
	}}
}

var (
	capabilityConfigIDSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"capability_id":{"type":"string","description":"Capability id, e.g. calendar.book."}
		},
		"required":["capability_id"]
	}`)

	capabilityConfigSetSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"capability_id":{"type":"string","description":"Capability id, e.g. calendar.book."},
			"values":{"type":"object",
				"description":"Field key → new value. Keys must be declared by the capability."}
		},
		"required":["capability_id","values"]
	}`)
)

// configFieldOut / configOut — the outbound payload shape (same across every facade).
type configFieldOut struct {
	Key         string          `json:"key"`
	Label       string          `json:"label"`
	Type        string          `json:"type"`
	Description string          `json:"description,omitempty"`
	Value       json.RawMessage `json:"value"`
	Default     json.RawMessage `json:"default"`
	Overridden  bool            `json:"overridden"`
}

type configOut struct {
	CapabilityID string           `json:"capability_id"`
	Fields       []configFieldOut `json:"fields"`
}

type configurableOut struct {
	Capabilities []string `json:"capabilities"`
}

func toConfigOut(capID string, fields []configField) configOut {
	out := make([]configFieldOut, 0, len(fields))
	for i := range fields {
		out = append(out, configFieldOut{
			Key: fields[i].Key, Label: fields[i].Label, Type: fields[i].Type,
			Description: fields[i].Description,
			Value:       json.RawMessage(fields[i].Value),
			Default:     json.RawMessage(fields[i].Default),
			Overridden:  fields[i].Overridden,
		})
	}
	return configOut{CapabilityID: capID, Fields: out}
}

func listConfigurable(ops capConfigOps) fp.Invoke {
	return func(ctx context.Context, _ string, _ json.RawMessage) (json.RawMessage, error) {
		return json.Marshal(configurableOut{Capabilities: ops.Configurable(ctx)})
	}
}

// capConfigTarget — names which capability's config to read/write.
type capConfigTarget struct {
	CapabilityID string `json:"capability_id"`
}

func getCapabilityConfig(ops capConfigOps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in capConfigTarget
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, fp.BadInput("invalid arguments: " + err.Error())
		}
		if err := fp.RequireArgs([2]string{"capability_id", in.CapabilityID}); err != nil {
			return nil, err
		}
		fields, err := ops.Get(ctx, ownerID, in.CapabilityID)
		if err != nil {
			return nil, err
		}
		return json.Marshal(toConfigOut(in.CapabilityID, fields))
	}
}

type capabilityConfigSetArgs struct {
	Values       map[string]json.RawMessage `json:"values"`
	CapabilityID string                     `json:"capability_id"`
}

func decodeConfigSet(raw json.RawMessage) (capabilityConfigSetArgs, error) {
	var in capabilityConfigSetArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return in, fp.BadInput("invalid arguments: " + err.Error())
	}
	return in, fp.RequireArgs([2]string{"capability_id", in.CapabilityID})
}

func setCapabilityConfig(ops capConfigOps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := decodeConfigSet(raw)
		if perr != nil {
			return nil, perr
		}
		if err := ops.Set(ctx, ownerID, in.CapabilityID, in.Values); err != nil {
			return nil, err
		}
		fields, gerr := ops.Get(ctx, ownerID, in.CapabilityID)
		if gerr != nil {
			return nil, gerr
		}
		return json.Marshal(toConfigOut(in.CapabilityID, fields))
	}
}
