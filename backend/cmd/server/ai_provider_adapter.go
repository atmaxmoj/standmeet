// ai_provider_adapter.go —— composition root 把 inference preset 表适配成 owner 的
// ProviderValidator 窄口(owner 不反依赖 inference,避免 inference→owner 成环)。

package main

import "github.com/atmaxmoj/standmeet/internal/conversation/inference"

// inferenceProviders —— owner.ProviderValidator 实现:provider 名是否是已知 preset。
type inferenceProviders struct{}

// Known —— provider 名在 inference preset 表里即合法。
func (inferenceProviders) Known(provider string) bool {
	_, ok := inference.Lookup(provider)
	return ok
}
