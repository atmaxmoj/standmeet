package stats

import "github.com/atmaxmoj/standmeet/internal/stats/entity"

// Types (implemented by: entity).
type (
	ActivityEvent     = entity.ActivityEvent
	CorpusGrowth      = entity.CorpusGrowth
	GraphNode         = entity.GraphNode
	HealthCheck       = entity.HealthCheck
	InferenceUsageDay = entity.InferenceUsageDay
	JobRegistry       = entity.JobRegistry
	ScheduledJob      = entity.ScheduledJob
	SystemInfo        = entity.SystemInfo
)

// Constructors/functions (implemented by: entity).
var NewJobRegistry = entity.NewJobRegistry
