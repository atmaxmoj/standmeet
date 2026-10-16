package entity

import "time"

// InferenceUsageDay — #106 LLM usage aggregated per day x model over the last
// 7 days (one row of the admin billing panel).
type InferenceUsageDay struct {
	Day          time.Time
	Model        string
	Calls        int64
	InputTokens  int64
	OutputTokens int64
}

// InferenceUsageFeature —— 7-day usage of one feature on one model ('chat:<role>',
// 'block:<plugin>'; empty = rows from before the feature was recorded).
type InferenceUsageFeature struct {
	Feature      string
	Model        string
	Calls        int64
	InputTokens  int64
	OutputTokens int64
}
