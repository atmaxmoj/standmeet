// socket_claim.go —— 单赢占位那两个 host op 的 controller(从 socket.go 拆出,守 350 行)。
//
// 沙箱那侧要它来盖住「先看一眼再动手」中间那个窗口:两个同时进来的调用方,看见的是同一个
// 「空着」,于是都动了手(F-B-15:同一格被订两次,真日历上并排两场)。

package capstore

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/infra/hostop"
)

type claimReq struct {
	Collection string `json:"collection"`
	Key        string `json:"key"`
	// TTLSeconds —— 这个占位活多久。0 = 用宿主的默认;超过上限会被截。
	TTLSeconds int `json:"ttl_seconds"`
}

func claimHandler(store BoundStore) hostop.Invoke {
	return func(ctx context.Context, raw json.RawMessage) (json.RawMessage, error) {
		var req claimReq
		if err := json.Unmarshal(raw, &req); err != nil {
			return nil, fmt.Errorf("capstore.claim: decode: %w", err)
		}
		got, err := store.Claim(ctx, req.Collection, req.Key, req.TTLSeconds)
		if err != nil {
			return nil, fmt.Errorf("capstore.claim: %w", err)
		}
		return jsonReply("capstore.claim", map[string]bool{"claimed": got})
	}
}

func releaseHandler(store BoundStore) hostop.Invoke {
	return func(ctx context.Context, raw json.RawMessage) (json.RawMessage, error) {
		var req claimReq
		if err := json.Unmarshal(raw, &req); err != nil {
			return nil, fmt.Errorf("capstore.release: decode: %w", err)
		}
		if err := store.Release(ctx, req.Collection, req.Key); err != nil {
			return nil, fmt.Errorf("capstore.release: %w", err)
		}
		return jsonReply("capstore.release", map[string]bool{"released": true})
	}
}

// jsonReply —— 回执编码收一处。分支留在这儿,handler 那边就只剩「解参 → 调 → 回」三步,
// 面上的 cyclo ≤3 是闸门要的形状。
func jsonReply(op string, v map[string]bool) (json.RawMessage, error) {
	out, err := json.Marshal(v)
	if err != nil {
		return nil, fmt.Errorf("%s: marshal: %w", op, err)
	}
	return out, nil
}
