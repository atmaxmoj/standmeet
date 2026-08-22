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
	"errors"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
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
		return nil, sayableListErr(lerr)
	}
	return models, nil
}

// sayableListErr —— 把「provider 那侧怎么了」翻成**收口认识的类别**。
//
// 为什么翻译落在组装根：`providermodels` 说的是 HTTP 的话（DisplayError 自带状态码 +
// 人话），域和收口都不认识 HTTP。不翻的话它一路当成未知错误，owner 在按钮底下读到的是
// **`internal error`** —— 而同一次失败在访客那条路上是一句「Couldn't reach the model
// provider — check the base URL and key.」。**同一个故障，两个面两句话，其中一句什么都没说。**
// （这是 F-R-11 的修法自己带出来的，驱 check 3 第三格时当场撞到。）
func sayableListErr(err error) error {
	var de apierr.DisplayError
	if !errors.As(err, &de) {
		return fmt.Errorf("list provider models: %w", err)
	}
	return fp.Coded(fp.BadInput(de.DisplayMessage()), de.DisplayCode())
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
