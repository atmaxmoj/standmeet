// res_capability_config.go —— 资源 capability_config:**任意**能力的可设置项。
//
// 这是面板给能力留的那个通用口子。能力在自己的 manifest 里声明有哪些配置项(键/类型/默认值),
// 这里通用地读回和写入 —— 收口这一层不认识任何一个字段的含义,更不认识 "booking"、
// "working_hours" 这种词。
//
// 它取代的是"每个能力一套手写路由 + 表单":booker 的预约策略以前就是那样,host 手写了
// 实体、默认值、读写、路由、表单,沙箱那边还有自己的一份,两份飘了。声明化之后,
// 加一个可配置项 = 在 manifest 里加一行,面板和存储自动跟上。

package dispatcher

import (
	"context"
	"encoding/json"
	"fmt"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

// CapabilityConfigStore —— 通用配置读写口。
type CapabilityConfigStore interface {
	// Configurable —— 哪些能力声明了可配置项(没声明的不该出现在面板上)。
	Configurable(ctx context.Context) []string
	Get(ctx context.Context, ownerID, capID string) ([]ConfigField, error)
	Set(ctx context.Context, ownerID, capID string, values map[string]json.RawMessage) error
}

// ConfigField —— 一个配置项的声明 + 当前值。
type ConfigField struct {
	Key         string
	Label       string
	Type        string
	Description string
	// Value / Default —— JSON 字面量。Overridden=false 时两者相同。
	Value      string
	Default    string
	Overridden bool
}

// CapabilityConfig —— capability_config 资源:list / get / set。
func CapabilityConfig(store CapabilityConfigStore) Resource {
	return Resource{Name: "capability_config", Ops: []Op{
		{
			ID: "capability_config.list",
			Description: "List the capability ids that declare configurable settings. " +
				"A capability with no declared settings never appears here.",
			InputSchema: emptyArgsSchema,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      capabilityConfigList(store),
		},
		{
			ID: "capability_config.get",
			Description: "Read one capability's settings: every field it declares, with the " +
				"value in effect and the declared default. Fields the owner never set report " +
				"the default and overridden=false.",
			InputSchema: capabilityIDSchema,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      capabilityConfigGet(store),
		},
		{
			ID: "capability_config.set",
			Description: "Set one capability's settings. Only keys the capability declares are " +
				"accepted; anything else is rejected rather than stored and ignored.",
			InputSchema: capabilityConfigSetSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      capabilityConfigSet(store),
		},
	}}
}

var capabilityIDSchema = json.RawMessage(`{
	"type":"object",
	"properties":{
		"capability_id":{"type":"string","description":"Capability id, e.g. calendar.book."}
	},
	"required":["capability_id"]
}`)

var capabilityConfigSetSchema = json.RawMessage(`{
	"type":"object",
	"properties":{
		"capability_id":{"type":"string","description":"Capability id, e.g. calendar.book."},
		"values":{"type":"object",
			"description":"Field key → new value. Keys must be declared by the capability."}
	},
	"required":["capability_id","values"]
}`)

// configFieldOut / configOut —— 出站载荷形状(两个面同一份)。
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

func toConfigFieldOut(f *ConfigField) configFieldOut {
	return configFieldOut{
		Key: f.Key, Label: f.Label, Type: f.Type, Description: f.Description,
		Value: json.RawMessage(f.Value), Default: json.RawMessage(f.Default),
		Overridden: f.Overridden,
	}
}

func capabilityConfigList(store CapabilityConfigStore) Invoke {
	return func(ctx context.Context, _ string, _ json.RawMessage) (json.RawMessage, error) {
		return marshalOut(configurableOut{Capabilities: store.Configurable(ctx)})
	}
}

// capConfigTarget —— 指名要读/写哪个能力的配置。
type capConfigTarget struct {
	CapabilityID string `json:"capability_id"`
}

func capabilityConfigGet(store CapabilityConfigStore) Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in capConfigTarget
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, BadInput("invalid arguments: " + err.Error())
		}
		if in.CapabilityID == "" {
			return nil, BadInput("capability_id is required")
		}
		fields, err := store.Get(ctx, ownerID, in.CapabilityID)
		if err != nil {
			return nil, fmt.Errorf("read capability config: %w", err)
		}
		return marshalOut(toConfigOut(in.CapabilityID, fields))
	}
}

func toConfigOut(capID string, fields []ConfigField) configOut {
	out := make([]configFieldOut, 0, len(fields))
	for i := range fields {
		out = append(out, toConfigFieldOut(&fields[i]))
	}
	return configOut{CapabilityID: capID, Fields: out}
}

type capabilityConfigSetArgs struct {
	Values       map[string]json.RawMessage `json:"values"`
	CapabilityID string                     `json:"capability_id"`
}

func parseCapConfigSet(raw json.RawMessage) (capabilityConfigSetArgs, error) {
	var in capabilityConfigSetArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return in, BadInput("invalid arguments: " + err.Error())
	}
	if in.CapabilityID == "" {
		return in, BadInput("capability_id is required")
	}
	return in, nil
}

func capabilityConfigSet(store CapabilityConfigStore) Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := parseCapConfigSet(raw)
		if perr != nil {
			return nil, perr
		}
		if err := store.Set(ctx, ownerID, in.CapabilityID, in.Values); err != nil {
			return nil, fmt.Errorf("write capability config: %w", err)
		}
		fields, gerr := store.Get(ctx, ownerID, in.CapabilityID)
		if gerr != nil {
			return nil, fmt.Errorf("read back capability config: %w", gerr)
		}
		return marshalOut(toConfigOut(in.CapabilityID, fields))
	}
}
