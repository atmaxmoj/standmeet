// periodic.go —— 工作区子系统自己的周期任务声明。
//
// 清扫过期工作区是本子系统的事,不是组装根的事。它以前住在组装根,只因为 ticker 和那份
// Monitor 簿记在那儿 —— 于是一段"什么算过期、扫完记什么"的知识离开了知道答案的地方。

package sandboxws

import (
	"context"
	"fmt"
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/periodic"
)

// sweepEvery —— TTL 是小时级,五分钟扫一次足够快,又不至于空转。
const sweepEvery = 5 * time.Minute

// PeriodicJobs —— 本子系统开出去的周期任务。组装根把它跟别处的声明汇在一起交给调度。
func (m *Manager) PeriodicJobs() []periodic.Job {
	return []periodic.Job{periodic.Named(
		"sandbox workspace sweep", sweepEvery,
		func(_ context.Context) error {
			if _, err := m.Sweep(); err != nil {
				return fmt.Errorf("sandbox workspace sweep: %w", err)
			}
			return nil
		},
	)}
}
