// usage_periodic.go —— 本域的周期任务:清 inference_usage 的老行。
//
// 它以前只在 boot 跑一次。一台跑三个月不重启的实例,第一天之后就再也没清过 —— 那不是
// "每 7 天清一次",那是"重启时清一次",而两句话在面板上长得一模一样。
//
// 清理规则本身在 SQL 里(计量行留着,不然油自己长回来);这里只管多久跑一次。

package repo

import (
	"context"
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/periodic"
)

// usageCleanupEvery —— 表按天涨,一天清一次够了;间隔那句话由它算出来,不另写一份。
const usageCleanupEvery = 24 * time.Hour

// UsagePeriodicJobs —— 本域开出去的周期任务。repo 为 nil → 一件也不开:
// 面板上不该出现一个永远 ok 却什么都没做的任务。
func UsagePeriodicJobs(r *InferenceUsageRepo) []periodic.Job {
	if r == nil {
		return []periodic.Job{}
	}
	return []periodic.Job{periodic.Named(
		"inference usage cleanup", usageCleanupEvery,
		func(ctx context.Context) error {
			return r.Cleanup(ctx)
		},
	)}
}
