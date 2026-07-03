package domain

import "time"

// InferenceUsageDay —— #106 近 7 天某一天×某 model 的 LLM 用量聚合(admin 计费面板一行)。
type InferenceUsageDay struct {
	Day          time.Time
	Model        string
	Calls        int64
	InputTokens  int64
	OutputTokens int64
}
