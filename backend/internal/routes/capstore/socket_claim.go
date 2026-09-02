// socket_claim.go — controller for the two single-winner claim host ops (split out of
// socket.go to keep it under the 350-line guard).
//
// The sandbox side needs this to cover the window between "look" and "act": two callers
// arriving at the same time both see the same "free" slot and both act on it (F-B-15: the
// same slot gets booked twice, two events land side by side on the real calendar).

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
	// TTLSeconds — how long this claim lives. 0 = use the host default; anything over the
	// cap gets clamped.
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

// jsonReply — centralizes reply encoding in one place. The branching lives here, so each
// handler is left with just decode -> call -> reply, keeping its cyclomatic complexity <=3
// the way the lint gate requires.
func jsonReply(op string, v map[string]bool) (json.RawMessage, error) {
	out, err := json.Marshal(v)
	if err != nil {
		return nil, fmt.Errorf("%s: marshal: %w", op, err)
	}
	return out, nil
}
