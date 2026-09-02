// periodic.go — the workspace subsystem's own periodic job declaration.
//
// Sweeping expired workspaces belongs to this subsystem, not the composition root. It used
// to live at the composition root only because the ticker and the Monitor bookkeeping lived
// there — so knowledge of "what counts as expired, what to log after a sweep" ended up away
// from the place that actually knows the answer.

package sandboxws

import (
	"context"
	"fmt"
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/periodic"
)

// sweepEvery — TTL is hour-scale, so a five-minute sweep interval is fast enough
// without spinning idle.
const sweepEvery = 5 * time.Minute

// PeriodicJobs — the periodic jobs this subsystem exposes. The composition root merges
// it with declarations from elsewhere and hands the set to the scheduler.
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
