package stats

import "github.com/atmaxmoj/standmeet/internal/stats/repo"

// 类型（实现:repo）.
type (
	ActivityRepo       = repo.ActivityRepo
	GrowthRepo         = repo.GrowthRepo
	InferenceUsageRepo = repo.InferenceUsageRepo
	// UsageRow —— 记一次用量的入参(含 provider + 算不算某箱油的账)。
	UsageRow = repo.UsageRow
)

// 构造/函数（实现:repo）.
var (
	NewActivityRepo       = repo.NewActivityRepo
	NewGrowthRepo         = repo.NewGrowthRepo
	NewInferenceUsageRepo = repo.NewInferenceUsageRepo
	UsagePeriodicJobs     = repo.UsagePeriodicJobs
)
