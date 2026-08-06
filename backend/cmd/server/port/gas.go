// gas.go —— composition root 把"一箱油还剩多少"接到访客那条路上(#7)。
//
// 油箱在 owner 域(owner_providers),用量在 stats 域(inference_usage),挡人的闸在
// conversation 域。三个域谁也不该 import 另外两个,所以那句算术留在 owner 域(它管着油箱),
// conversation 只声明一个"还剩多少"的窄口,组装根在这里把它接上。
//
// **算术只有一份**:面板上给 owner 看的读数和挡住访客的这道闸,走的是同一个函数。

package port

import (
	"context"
	"fmt"

	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
)

// OwnerGas —— conversation.GasGauge 实现。
type OwnerGas struct {
	Providers owner.ProvidersUseDeps
}

// Remaining —— 这条 provider 还剩多少 token。nil = 没挂表(不计量)。
func (g OwnerGas) Remaining(
	ctx context.Context, ownerID, providerID string,
) (*int64, error) {
	left, err := owner.GasRemaining(ctx, g.Providers, ownerID, providerID)
	if err != nil {
		return nil, fmt.Errorf("provider gas: %w", err)
	}
	return left, nil
}
