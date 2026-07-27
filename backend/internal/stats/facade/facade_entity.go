package stats

import "github.com/atmaxmoj/standmeet/internal/stats/entity"

// 类型（实现:entity）.
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

// 构造/函数（实现:entity）.
var NewJobRegistry = entity.NewJobRegistry
