// capreg_ext_mcp_deps.go —— ext-mcp 工具的 connector-dep 闸（§一 ext-mcp 默认不接 dep）。
//
// ext-mcp 是最低信任：别人写的进程，owner 只是注册了 URL。它的工具即便经 `_meta.requires`
// 声明依赖某 connector（如 calendar）且该 connector 已连，默认也**不**注入句柄——连接器
// 句柄带 owner 权限，自动给任意注册 server 等于把 owner 账号借出去。两个条件同时满足才放行：
//   ① owner 在 server.GrantedDeps 里**显式授权**了这个 dep（默认空 = 全拒）；
//   ② 该 dep 已连（连没连查 DepRegistry）。
// 任一不满足 → 隐藏该工具。无 requires 的工具不受此闸。逻辑收在这一处，跟 ext-mcp 工具
// 暴露同模块（capreg_ext_mcp.go 的 absorb 调本文件）。

package capload

import (
	"context"
	"encoding/json"
	"slices"

	"github.com/atmaxmoj/standmeet/internal/capabilities/mcpclient"
	"github.com/atmaxmoj/standmeet/internal/marketplace"
)

// DepConnected —— 命名 connector 依赖是否已连（capreg.DepRegistry 满足）。grant 在
// server config，connected 查这里；两者都过工具才放行。
type DepConnected interface {
	AllConnected(ctx context.Context, ownerID string, deps []string) (bool, error)
}

// extToolDepsAllowed —— 该 ext-mcp 工具的 connector-dep 是否放行（最低信任，默认拒）：
// requires 必须 owner 全部显式 grant + 连接器已连。无 requires 的工具不受闸。
func extToolDepsAllowed(
	ctx context.Context, cfg *marketplace.MCPServerConfig, connected DepConnected,
	t *mcpclient.Tool,
) bool {
	requires := toolRequires(t)
	if len(requires) == 0 {
		return true
	}
	if !allDepsGranted(cfg.GrantedDeps, requires) {
		return false // owner 没显式授权 → 拒（默认全拒）
	}
	if connected == nil {
		return false // 没装 connected 查询 → 保守拒（连没连不确定不暴露能调外部的工具）
	}
	conn, err := connected.AllConnected(ctx, cfg.OwnerID, requires)
	return err == nil && conn
}

// allDepsGranted —— requires 是否都在 owner 显式授权的 granted 里。
func allDepsGranted(granted, requires []string) bool {
	for _, dep := range requires {
		if !slices.Contains(granted, dep) {
			return false
		}
	}
	return true
}

// toolRequires —— 读 ext-mcp tool `_meta.requires`（JSON []string）。无 / 形状不对 → 空。
// 经 JSON round-trip 抽成 []string（避开对 map[string]any 值做 any/interface{} 断言：
// 那会撞 forbidigo-禁-any 与 revive-要-any 的对冲）。
func toolRequires(t *mcpclient.Tool) []string {
	v, ok := t.Meta["requires"]
	if !ok {
		return []string{}
	}
	raw, merr := json.Marshal(v)
	if merr != nil {
		return []string{}
	}
	out := []string{}
	if json.Unmarshal(raw, &out) != nil {
		return []string{}
	}
	return out
}
