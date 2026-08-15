// connector_needs.go —— 市场卡上那句「还需要哪个连接器」的两半，在组装根合上（F-F-4）。
//
// 一个技能声明它要用哪些**工具**（SKILL.md 的 `allowed-tools`）；一个能力声明它要哪些
// **连接器**（manifest 的 `requires`）；owner 连了哪些连接器，在连接器那一侧。marketplace 域
// 一半都不认识，所以它只声明一个端口（`ConnectorNeeds`），这里把三处接起来：
//
//	allowed-tools ─▶ 能力注册表（谁提供这个工具、它要什么）─▶ 连接器（连没连）
//
// 为什么在根：这条链跨了三个不该互相认识的地方。跟 mcp_probe.go 是同一个形状 ——
// 域问一句话，根拿现成的零件答。
//
// 为什么持 Runtime 而不是持那两张表：这两张表都在 `registerAgentSkills` 里才建好，而出站
// 收口比它先装配。持 Runtime = 到**真被调用时**才去取，那时两张表都齐了。

package main

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"
)

// connectorNeeds —— marketplace.ConnectorNeeds 的实现。
type connectorNeeds struct {
	rt *deps.Runtime
}

// DepsForTools —— 这些工具背后要哪些连接器。注册表里只认得**声明过自己工具名**的能力
// （manifest 的 `visitor_tools`）；认不出来的返回空 —— 那是「这张表不认识它」，
// 调用方据此把该技能的 needs 留成 nil（未知），而不是 []（不缺）。
func (n *connectorNeeds) DepsForTools(tools []string) []string {
	if n.rt.AgentSkills == nil || len(tools) == 0 {
		return []string{}
	}
	return n.rt.AgentSkills.DepsForTools(tools)
}

// Unconnected —— 这些连接器里,这个 owner 还没连的那些。
func (n *connectorNeeds) Unconnected(
	ctx context.Context, ownerID string, names []string,
) ([]string, error) {
	if n.rt.DepRegistry == nil || len(names) == 0 {
		return []string{}, nil
	}
	out, err := n.rt.DepRegistry.Unconnected(ctx, ownerID, names)
	if err != nil {
		return nil, fmt.Errorf("unconnected deps: %w", err)
	}
	return out, nil
}
