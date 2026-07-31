// res_capabilities.go —— 资源 capabilities:owner 的"访客能用什么"面板。
//
// 一行可能是三种东西之一(kind 区分):
//
//	capability  能力注册表里**面向访客**的那些(owner-only 的不在此列:owner-enable 闸
//	            只作用于访客装配,给 owner-only 放开关是个不起作用的开关)
//	connector   平台托管的连接器槽(日历 / 邮件),可关不可删
//	skill       owner 自己写的 skill,enabled 读的是 skill 自己的全局开关
//
// 迁移前 MCP 面比 admin 少两样:**connector 行整类缺席**,而且依赖状态只给一个
// dependency_connected 布尔、没有名字。也就是说 owner 从 Claude Code 看这张表,
// 看不到日历/邮件槽,也不知道某个能力等的是哪个连接器。现在只有一份形状。

package dispatcher

import (
	"context"
	"encoding/json"
	"fmt"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

// CapabilityStore —— capabilities 这组操作所需的最小口。
//
// 装配那张表要读四处(注册表 / owner-enable 表 / owner skill / 连接器槽),
// 但那是**组装根**的编排:收口只要一个"给我这张表"。
type CapabilityStore interface {
	List(ctx context.Context, ownerID string) ([]CapabilityRow, error)
	SetEnabled(ctx context.Context, ownerID, id string, enabled bool) error
	Delete(ctx context.Context, ownerID, id string) error
}

// CapabilityRow —— 表里的一行。
type CapabilityRow struct {
	Dependency *CapabilityDependency
	ID         string
	Title      string
	Origin     string
	Kind       string
	Enabled    bool
	Deletable  bool
}

// CapabilityDependency —— 这一行等的那个连接器,以及它连上没有。
type CapabilityDependency struct {
	Name      string
	Connected bool
}

// Capabilities —— capabilities 资源:list / set_enabled / delete。
func Capabilities(store CapabilityStore) Resource {
	return Resource{Name: "capabilities", Ops: []Op{
		{
			ID: "capabilities.list",
			Description: "List what visitors can use on this instance: registry " +
				"capabilities, managed connector slots, and owner-authored skills — " +
				"each with its origin, enabled state and connector dependency status.",
			InputSchema: json.RawMessage(`{"type":"object","properties":{}}`),
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      capabilitiesList(store),
		},
		{
			ID: "capabilities.set_enabled",
			Description: "Enable or disable one row. A disabled capability never enters " +
				"a visitor session, even when a role attaches it.",
			InputSchema: json.RawMessage(`{
				"type":"object",
				"properties":{
					"id":{"type":"string","description":"Capability / skill id."},
					"enabled":{"type":"boolean","description":"true to enable."}
				},
				"required":["id","enabled"]
			}`),
			Kind:   fp.Action,
			Reach:  fp.OwnerAction(),
			Invoke: capabilitiesSetEnabled(store),
		},
		{
			ID: "capabilities.delete",
			Description: "Delete an owner-authored skill row. Built-in capabilities and " +
				"managed connectors cannot be deleted.",
			InputSchema: json.RawMessage(`{
				"type":"object",
				"properties":{"id":{"type":"string","description":"Owner-authored skill id."}},
				"required":["id"]
			}`),
			Kind:   fp.Action,
			Reach:  fp.OwnerAction(),
			Invoke: capabilitiesDelete(store),
		},
	}}
}

// capabilityDependencyRow / capabilityRowOut —— 出站载荷形状(两个面同一份)。
type capabilityDependencyRow struct {
	Name      string `json:"name"`
	Connected bool   `json:"connected"`
}

type capabilityRowOut struct {
	Dependency *capabilityDependencyRow `json:"dependency,omitempty"`
	ID         string                   `json:"id"`
	Title      string                   `json:"title,omitempty"`
	Origin     string                   `json:"origin"`
	Kind       string                   `json:"kind"`
	Enabled    bool                     `json:"enabled"`
	Deletable  bool                     `json:"deletable"`
}

// capabilitiesListOut —— admin 一直是包一层 {"capabilities": [...]} 发出去的,
// 那是已经发出去的契约,所以两个面都用它。
type capabilitiesListOut struct {
	Capabilities []capabilityRowOut `json:"capabilities"`
}

func toCapabilityRowOut(r *CapabilityRow) capabilityRowOut {
	out := capabilityRowOut{
		ID: r.ID, Title: r.Title, Origin: r.Origin, Kind: r.Kind,
		Enabled: r.Enabled, Deletable: r.Deletable,
	}
	if r.Dependency != nil {
		out.Dependency = &capabilityDependencyRow{
			Name: r.Dependency.Name, Connected: r.Dependency.Connected,
		}
	}
	return out
}

func capabilitiesList(store CapabilityStore) Invoke {
	return func(ctx context.Context, ownerID string, _ json.RawMessage) (json.RawMessage, error) {
		rows, err := store.List(ctx, ownerID)
		if err != nil {
			return nil, fmt.Errorf("list capabilities: %w", err)
		}
		out := make([]capabilityRowOut, 0, len(rows))
		for i := range rows {
			out = append(out, toCapabilityRowOut(&rows[i]))
		}
		return marshalOut(capabilitiesListOut{Capabilities: out})
	}
}

type capabilityEnabledArgs struct {
	ID      string `json:"id"`
	Enabled bool   `json:"enabled"`
}

func capabilitiesSetEnabled(store CapabilityStore) Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in capabilityEnabledArgs
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, BadInput("invalid arguments: " + err.Error())
		}
		if in.ID == "" {
			return nil, BadInput("id is required")
		}
		if err := store.SetEnabled(ctx, ownerID, in.ID, in.Enabled); err != nil {
			return nil, fmt.Errorf("set capability enabled: %w", err)
		}
		return marshalOut(map[string]bool{"ok": true})
	}
}

type capabilityIDArgs struct {
	ID string `json:"id"`
}

func capabilitiesDelete(store CapabilityStore) Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in capabilityIDArgs
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, BadInput("invalid arguments: " + err.Error())
		}
		if in.ID == "" {
			return nil, BadInput("id is required")
		}
		if err := store.Delete(ctx, ownerID, in.ID); err != nil {
			return nil, fmt.Errorf("delete capability: %w", err)
		}
		return marshalOut(map[string]bool{"ok": true})
	}
}
