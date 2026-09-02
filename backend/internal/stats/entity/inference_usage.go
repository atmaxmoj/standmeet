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
