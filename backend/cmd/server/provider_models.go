// provider_models.go —— owner 问自己已配好的那条 provider：你有哪些模型（F-R-11）。
//
// 为什么实现落在组装根、而不是 owner 域里：那条 provider 的 key 在库里是密文，而**内侧只封
// 不解**（见 unseal.go 开头那段）。域声明端口（`ProviderModelLister`），根这边把两件已经有的
// 东西接起来：
//
//   - `openAIProviderKey`（unseal.go）—— 把「存起来的样子」翻成「能直接用的样子」；
//   - `infra/providermodels.List` —— 拉列表那段无状态代码，访客那条 BYOAI 路走的是同一份。
//
// 所以这也不是新造的一条出站路：owner 那颗 `LOAD MODELS` 从此走的是「服务端拿自己存的那把
// key 去问」，而不是「让页面把它读不到的东西发上来」。
//
// (上面这段跟 package 之间空一行:包注释只有一份,在 doc.go。)

package main

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/infra/providermodels"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
)

// providerModelLister —— ProviderModelLister 的实现。
type providerModelLister struct {
	owners *owner.Repo
}

// ListModels —— 读那一行、开封 key、问上游。providerID 空 = 默认那条。
func (l *providerModelLister) ListModels(
	ctx context.Context, ownerID, providerID string,
) ([]string, error) {
	row, err := l.providerRow(ctx, ownerID, providerID)
	if err != nil {
		return nil, err
	}
	key, kerr := openAIProviderKey(ownerID, row.KeyEnc)
	if kerr != nil {
		return nil, fmt.Errorf("open provider key: %w", kerr)
	}
	models, lerr := providermodels.List(ctx, row.Provider, row.Endpoint, key)
	if lerr != nil {
		return nil, fmt.Errorf("list provider models: %w", lerr)
	}
	return models, nil
}

func (l *providerModelLister) providerRow(
	ctx context.Context, ownerID, providerID string,
) (owner.ProviderRow, error) {
	if providerID == "" {
		row, err := l.owners.DefaultProvider(ctx, ownerID)
		if err != nil {
			return owner.ProviderRow{}, fmt.Errorf("default provider: %w", err)
		}
		return row, nil
	}
	row, err := l.owners.GetProvider(ctx, ownerID, providerID)
	if err != nil {
		return owner.ProviderRow{}, fmt.Errorf("get provider: %w", err)
	}
	return row, nil
}
