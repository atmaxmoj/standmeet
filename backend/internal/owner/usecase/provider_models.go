// provider_models.go —— 「这条 provider 有哪些模型可用」，问的是 owner **已经配好的**那一条。
//
// 为什么需要它（F-R-11）：面板上那颗 `LOAD MODELS` 一直打的是访客那条无 auth 的路
// （`/api/v1/inference/models`），而那条路要求调用方**把 key 一起发上来** —— 访客确实是
// 自己拿着 key 的。owner 不是：他的 key 存在库里、页面永远读不回来（那是对的）。于是他
// 保存之后再点这颗按钮，客户端发的是一个空 key，后端 400 `key required`，屏幕上什么都没有。
// 那把 key 明明在，每一轮访客对话都在用它。
//
// Lister 是**端口不是仓储**：key 在库里是密文，而这一侧从不解封（跟 MCPServerProber 同一条
// 规矩）。实现落在组装根 —— 那里既有开封器（`unseal.go` 的 openAIProviderKey），也有拉列表
// 的那段无状态代码（`infra/providermodels`）。
//
// 没接实现（nil）时说清楚这台实例没有这个能力，而不是假装问过。

package usecase

import (
	"context"
	"errors"
	"fmt"
)

// ProviderModelLister —— 去问 owner 已配好的那条 provider：你有哪些模型。
type ProviderModelLister interface {
	ListModels(ctx context.Context, ownerID, providerID string) ([]string, error)
}

// ErrNoModelLister —— 这台实例没接模型探针。
var ErrNoModelLister = errors.New("this instance cannot list models")

// ListProviderModels —— 端口的调用点。providerID 空 = 那条默认的。
func ListProviderModels(
	ctx context.Context, lister ProviderModelLister, ownerID, providerID string,
) ([]string, error) {
	if lister == nil {
		return nil, ErrNoModelLister
	}
	models, err := lister.ListModels(ctx, ownerID, providerID)
	if err != nil {
		return nil, fmt.Errorf("list provider models: %w", err)
	}
	return models, nil
}
