// enable_gate.go —— owner 的"这个能力开不开"闸,接到能力注册表上。

package axiscap

import (
	"context"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"
)

// CapabilityEnableGate —— Phase H: 把 owner-enable 闸接到 registry。访客
// 装配时 registry 据此把 owner 关掉的 capability 摘掉。DB 错 → fail-open
// (返 nil = 全开)，保 availability，不让一次读失败把所有能力都拦了。
func CapabilityEnableGate(d *deps.Runtime) {
	d.AgentSkills.SetEnableGate(func(ctx context.Context, ownerID string) map[string]bool {
		disabled, err := d.CapabilityRepo.DisabledSet(ctx, ownerID)
		if err != nil {
			d.Log.Warn("capability enable-gate load", "err", err, "owner", ownerID)
			return map[string]bool{}
		}
		return disabled
	})
}
