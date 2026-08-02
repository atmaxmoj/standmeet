// port_ai_provider.go —— composition root 把 inference preset 表适配成 owner 的
// ProviderValidator 窄口(owner 不反依赖 inference,避免 inference→owner 成环)。

package main

import (
	"github.com/atmaxmoj/standmeet/internal/conversation/inference"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
)

// inferenceProviders —— owner.ProviderValidator 实现:provider 名是否是已知 preset。
type inferenceProviders struct{}

// Known —— provider 名在 inference preset 表里即合法。
func (inferenceProviders) Known(provider string) bool {
	_, ok := inference.Lookup(provider)
	return ok
}

// aiPresets —— 同一张表的另一半:owner 声明 ai_provider.presets 时要把它列出来。
// 也走组装根搬运,理由同上(owner 不能 import inference)。
func aiPresets() []owner.AIPreset {
	presets := inference.All()
	out := make([]owner.AIPreset, 0, len(presets))
	for i := range presets {
		out = append(out, owner.AIPreset{
			Name: presets[i].Name, Label: presets[i].Label,
			BaseURL: presets[i].BaseURL, KeyPrefix: presets[i].KeyPrefix,
		})
	}
	return out
}
