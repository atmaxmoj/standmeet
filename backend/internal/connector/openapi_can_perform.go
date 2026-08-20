// openapi_can_perform.go —— 「这个 owner 的授权，做不做得了这一个 operation」。
//
// 为什么单独一问（F-B-8 ⭐⭐）：`Connected` 说的是**我们手里有一个可用连接**，
// 那不等于**这个连接做得了你要它做的事**。owner 只授了 `calendar.readonly` 时，
// 连接是好的、读是通的、列时段也是好的，**只有写永远 403** —— 而产品照旧把「订会」
// 摆在访客面前，还告诉他「过一会儿再问」（那句话永远不会成真）。
//
// 两边现在都是数据：**需要什么**在 spec 的 per-op `security` 里，**授到了什么**在连接行上。
// 谁也没被抄进 Go —— 抄进来就会有第二份真相，而它迟早跟 spec 分叉。

package connector

import (
	"context"
	"fmt"
)

// CanPerform —— spec 没为这个 op 声明 scope → true（这一步不要求额外权限）。
func (c *openapiCore) CanPerform(ctx context.Context, ownerID, operationID string) (bool, error) {
	need := c.runtime.ScopesFor(operationID)
	if len(need) == 0 {
		return true, nil
	}
	conn, err := c.store.Get(ctx, c.id, ownerID)
	if err != nil {
		return false, fmt.Errorf("connector %q can-perform %q: %w", c.id, operationID, err)
	}
	return grantCovers(conn.Scopes, need), nil
}

// grantCovers —— 授到的 ⊇ 需要的。
func grantCovers(granted, need []string) bool {
	have := make(map[string]bool, len(granted))
	for _, g := range granted {
		have[g] = true
	}
	for _, n := range need {
		if !have[n] {
			return false
		}
	}
	return true
}
