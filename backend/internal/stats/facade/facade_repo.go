package stats

import "github.com/atmaxmoj/standmeet/internal/stats/repo"

// Types (implemented by: repo).
type (
	ActivityRepo       = repo.ActivityRepo
	GrowthRepo         = repo.GrowthRepo
	InferenceUsageRepo = repo.InferenceUsageRepo
	// UsageRow -- the input for recording one usage event (provider + whether it counts
	// against a given quota bucket).
	UsageRow = repo.UsageRow
)

// Constructors/functions (implemented by: repo).
var (
	NewActivityRepo       = repo.NewActivityRepo
	NewGrowthRepo         = repo.NewGrowthRepo
	NewInferenceUsageRepo = repo.NewInferenceUsageRepo
	UsagePeriodicJobs     = repo.UsagePeriodicJobs
)
