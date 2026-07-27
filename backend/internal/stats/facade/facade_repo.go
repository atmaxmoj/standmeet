package stats

import "github.com/atmaxmoj/standmeet/internal/stats/repo"

// 类型（实现:repo）.
type (
	ActivityRepo       = repo.ActivityRepo
	GrowthRepo         = repo.GrowthRepo
	InferenceUsageRepo = repo.InferenceUsageRepo
)

// 构造/函数（实现:repo）.
var (
	NewActivityRepo       = repo.NewActivityRepo
	NewGrowthRepo         = repo.NewGrowthRepo
	NewInferenceUsageRepo = repo.NewInferenceUsageRepo
)
