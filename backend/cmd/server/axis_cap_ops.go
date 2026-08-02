// axis_cap_ops.go —— 资源 capabilities:owner 的"访客能用什么"面板,由**能力轴**自己声明。
//
// 这一组没有域可归:它读的是能力注册表和连接器槽 —— 两根插件轴,按设计就住在组装根这边。
// 所以声明也在这里,而不是在收口里(收口只汇聚各域的正门)。
//
// 一行可能是三种东西之一(kind 区分):
//
//	capability  能力注册表里**面向访客**的那些(owner-only 的不在此列:owner-enable 闸
//	            只作用于访客装配,给 owner-only 放开关是个不起作用的开关)
//	connector   平台托管的连接器槽(日历 / 邮件),可关不可删
//	skill       owner 自己写的 skill,enabled 读的是 skill 自己的全局开关
//
// 归一化前 MCP 面比 admin 少两样:**connector 行整类缺席**,而且依赖状态只给一个
// dependency_connected 布尔、没有名字。也就是说 owner 从 Claude Code 看这张表,
// 看不到日历/邮件槽,也不知道某个能力等的是哪个连接器。现在只有一份形状。

package main

import (
	"context"
	"encoding/json"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

// capabilityResource —— list / set_enabled / delete。
func capabilityResource(d *runtimeDeps) dispatcher.Resource {
	ops := newCapabilityOps(d)
	return dispatcher.Resource{Name: "capabilities", Ops: []fp.Op{
		{
			ID: "capabilities.list",
			Description: "List what visitors can use on this instance: registry " +
				"capabilities, managed connector slots, and owner-authored skills — " +
				"each with its origin, enabled state and connector dependency status.",
			InputSchema: fp.NoArgs,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      listCapabilities(ops),
		},
		{
			ID: "capabilities.set_enabled",
			Description: "Enable or disable one row. A disabled capability never enters " +
				"a visitor session, even when a role attaches it.",
			InputSchema: capabilityEnabledSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      setCapabilityEnabled(ops),
		},
		{
			ID: "capabilities.delete",
			Description: "Delete an owner-authored skill row. Built-in capabilities and " +
				"managed connectors cannot be deleted.",
			InputSchema: capabilityRowIDSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      deleteCapability(ops),
		},
	}}
}

var (
	capabilityEnabledSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"id":{"type":"string","description":"Capability / skill id."},
			"enabled":{"type":"boolean","description":"true to enable."}
		},
		"required":["id","enabled"]
	}`)

	capabilityRowIDSchema = json.RawMessage(`{
		"type":"object",
		"properties":{"id":{"type":"string","description":"Owner-authored skill id."}},
		"required":["id"]
	}`)
)

// capabilityRow / capabilityDependency —— 表里的一行,以及它等的那个连接器。
type capabilityRow struct {
	Dependency *capabilityDependency `json:"dependency,omitempty"`
	ID         string                `json:"id"`
	Title      string                `json:"title,omitempty"`
	Origin     string                `json:"origin"`
	Kind       string                `json:"kind"`
	Enabled    bool                  `json:"enabled"`
	Deletable  bool                  `json:"deletable"`
}

type capabilityDependency struct {
	Name      string `json:"name"`
	Connected bool   `json:"connected"`
}

// capabilityListOut —— admin 一直是包一层 {"capabilities": [...]} 发出去的,
// 那是已经发出去的契约,所以每个面都用它。
type capabilityListOut struct {
	Capabilities []capabilityRow `json:"capabilities"`
}

func listCapabilities(ops capabilityOps) fp.Invoke {
	return func(ctx context.Context, ownerID string, _ json.RawMessage) (json.RawMessage, error) {
		rows, err := ops.List(ctx, ownerID)
		if err != nil {
			return nil, fp.OpErr("list capabilities", err)
		}
		return json.Marshal(capabilityListOut{Capabilities: rows})
	}
}

type capabilityEnabledArgs struct {
	ID      string `json:"id"`
	Enabled bool   `json:"enabled"`
}

func setCapabilityEnabled(ops capabilityOps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in capabilityEnabledArgs
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, fp.BadInput("invalid arguments: " + err.Error())
		}
		if err := fp.RequireArgs([2]string{"id", in.ID}); err != nil {
			return nil, err
		}
		if err := ops.SetEnabled(ctx, ownerID, in.ID, in.Enabled); err != nil {
			return nil, fp.OpErr("set capability enabled", err)
		}
		return json.Marshal(map[string]bool{"ok": true})
	}
}

type capabilityRowIDArgs struct {
	ID string `json:"id"`
}

func deleteCapability(ops capabilityOps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in capabilityRowIDArgs
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, fp.BadInput("invalid arguments: " + err.Error())
		}
		if err := fp.RequireArgs([2]string{"id", in.ID}); err != nil {
			return nil, err
		}
		if err := ops.Delete(ctx, ownerID, in.ID); err != nil {
			return nil, err
		}
		return json.Marshal(map[string]bool{"ok": true})
	}
}
