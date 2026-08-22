// agent_ops.go —— `connectors.agent_ops`：已连上、且开了「暴露给访客 AI」的连接器，
// 各自有哪些 operation 可以授权。
//
// **为什么要有这一条**（F-C-57）：装配那一屏的复选框写着 *"Let a visitor's AI call these
// operations directly … subject to per-code grants"*，而会话侧的闸比的是「这个角色挂的技能的
// `allowed_tools` 里有没有 `op_<id>`」。也就是说勾完之后还差一步授权，而 owner 要完成那一步，
// 先得知道**这些 operation 叫什么名字** —— 产品以前从来没说过。
//
// 让 owner 照着厂商文档手打 `op_gists_list` 不算「说过」：那个名字是产品自己规范化出来的
// （`agent_tool_name.go`），厂商文档里根本没有这个串。

package axisconn

import (
	"context"
	"encoding/json"

	"github.com/atmaxmoj/standmeet/internal/connector"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

// agentOpOut —— 一个可授权的 operation：工具名 + 它自己那句说明。
type agentOpOut struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

// agentOpsRowOut —— 一个连接器 + 它暴露出来的那些 operation。
// 带上 title/category 是因为一份厂商文档可能有上千个 op，不说清是谁的就没法读。
type agentOpsRowOut struct {
	ConnectorID string       `json:"connector_id"`
	Title       string       `json:"title,omitempty"`
	Category    string       `json:"category,omitempty"`
	Ops         []agentOpOut `json:"ops"`
}

func agentOpsList(ops connectorOps) fp.Invoke {
	return func(ctx context.Context, ownerID string, _ json.RawMessage) (json.RawMessage, error) {
		conns, err := ops.svc.List(ctx, ownerID)
		if err != nil {
			return nil, fp.OpErr("list connectors", err)
		}
		return json.Marshal(agentOpsRows(ops, conns))
	}
}

// agentOpsRows —— 已连上的那些 → 各自的 op 清单。**未连的不列**：一个连不上的连接器
// 授权了也调不到，把它摆在选择器里等于请 owner 授一个不会生效的权限。
func agentOpsRows(ops connectorOps, conns []connector.Connection) []agentOpsRowOut {
	byID := ops.slots.AgentOpsByID(connectedIDsOf(conns))
	rows := make([]agentOpsRowOut, 0, len(byID))
	for i := range conns {
		list, has := byID[conns[i].ConnectorID]
		if !has {
			continue
		}
		rows = append(rows, agentOpsRowOut{
			ConnectorID: conns[i].ConnectorID,
			Title:       conns[i].Title,
			Category:    conns[i].Category,
			Ops:         toAgentOpOuts(list),
		})
	}
	return rows
}

func connectedIDsOf(conns []connector.Connection) []string {
	out := make([]string, 0, len(conns))
	for i := range conns {
		if conns[i].Connected {
			out = append(out, conns[i].ConnectorID)
		}
	}
	return out
}

func toAgentOpOuts(list []connector.AgentOpView) []agentOpOut {
	out := make([]agentOpOut, 0, len(list))
	for i := range list {
		out = append(out, agentOpOut{Name: list[i].Name, Description: list[i].Description})
	}
	return out
}
