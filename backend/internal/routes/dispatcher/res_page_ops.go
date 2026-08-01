// res_page_ops.go —— page 资源的解参 / 调用 / 序列化(声明在 res_page.go)。

package dispatcher

import (
	"context"
	"encoding/json"
)

func pageGet(store PageStore) Invoke {
	return func(ctx context.Context, ownerID string, _ json.RawMessage) (json.RawMessage, error) {
		out, err := store.Get(ctx, ownerID)
		if err != nil {
			return nil, opErr("read page", err)
		}
		return out, nil
	}
}

func pagePut(store PageStore) Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		out, err := store.Put(ctx, ownerID, raw)
		if err != nil {
			return nil, opErr("save page", err)
		}
		return out, nil
	}
}

func pagePinnable(store PageStore) Invoke {
	return func(ctx context.Context, ownerID string, _ json.RawMessage) (json.RawMessage, error) {
		items, err := store.Pinnable(ctx, ownerID)
		if err != nil {
			return nil, opErr("list pinnable", err)
		}
		if items == nil {
			items = []PinCandidate{}
		}
		return marshalOut(items)
	}
}

type pinArgs struct {
	Section string `json:"section"`
	WikiID  string `json:"wiki_id"`
}

// pinnedOut —— pin / unpin 的回执:动完之后这个栏目是什么样。
type pinnedOut struct {
	Section string   `json:"section"`
	Pinned  []string `json:"pinned"`
}

// pagePinMutate —— pin 和 unpin 只差调哪个函数;解参和回包形状同一份。
func pagePinMutate(
	apply func(ctx context.Context, ownerID, section, wikiID string) ([]string, error),
	what string,
) Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := parsePinArgs(raw)
		if perr != nil {
			return nil, perr
		}
		pinned, err := apply(ctx, ownerID, in.Section, in.WikiID)
		if err != nil {
			return nil, opErr(what, err)
		}
		return marshalOut(pinnedOut{Section: in.Section, Pinned: nonNilStrings(pinned)})
	}
}

func parsePinArgs(raw json.RawMessage) (pinArgs, error) {
	var in pinArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return in, BadInput("invalid arguments: " + err.Error())
	}
	if err := requireArgs([2]string{"section", in.Section},
		[2]string{"wiki_id", in.WikiID}); err != nil {
		return in, err
	}
	return in, nil
}

type pageHandleArgs struct {
	Handle string `json:"handle"`
}

func pageSetHandle(store PageStore) Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in pageHandleArgs
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, BadInput("invalid arguments: " + err.Error())
		}
		addr, err := store.SetHandle(ctx, ownerID, in.Handle)
		if err != nil {
			return nil, opErr("set handle", err)
		}
		return marshalOut(addr)
	}
}

type pagePublicURLArgs struct {
	PublicURL string `json:"public_url"`
}

func pageSetPublicURL(store PageStore) Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in pagePublicURLArgs
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, BadInput("invalid arguments: " + err.Error())
		}
		addr, err := store.SetPublicURL(ctx, ownerID, in.PublicURL)
		if err != nil {
			return nil, opErr("set public url", err)
		}
		return marshalOut(addr)
	}
}
