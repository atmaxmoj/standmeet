// provider_models.go —— `providers.list_models`：问 owner **已经配好的**那条 provider 有哪些模型。
//
// 为什么单独一条而不是复用访客那条（F-R-11）：访客那条（`/api/v1/inference/models`）没有 auth，
// 所以它要求调用方把 key 一起发上来 —— 访客确实自己拿着 key。owner 不是：他的 key 存在库里、
// 页面永远读不回来。以前面板上那颗按钮打的就是访客那条路，发出去一个空 key，400，屏幕上没话。
//
// 出站没有 key，也没有 endpoint —— 只有模型名。owner 要的是「我能选哪些」。

package ops

import (
	"context"
	"encoding/json"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/owner/usecase"
)

var providerModelsSchema = json.RawMessage(`{
	"type":"object",
	"properties":{
		"id":{"type":"string","description":"Provider id; omit for the default one."}
	}
}`)

type providerModelsArgs struct {
	ID string `json:"id"`
}

type providerModelsOut struct {
	Models []string `json:"models"`
}

func listProviderModels(lister usecase.ProviderModelLister) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		args, derr := decodeProviderModelsArgs(raw)
		if derr != nil {
			return nil, derr
		}
		models, err := usecase.ListProviderModels(ctx, lister, ownerID, args.ID)
		if err != nil {
			return nil, providerErr("list provider models", err)
		}
		return json.Marshal(providerModelsOut{Models: models})
	}
}

// decodeProviderModelsArgs —— 参数全可选：空 body 也算合法（面板那颗按钮问的就是「默认那条」）。
func decodeProviderModelsArgs(raw json.RawMessage) (providerModelsArgs, error) {
	var args providerModelsArgs
	if len(raw) == 0 {
		return args, nil
	}
	if err := json.Unmarshal(raw, &args); err != nil {
		return args, fp.BadInput("invalid arguments: " + err.Error())
	}
	return args, nil
}
