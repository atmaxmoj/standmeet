// socket.go —— capstore 的四个 host op(insert/query/count/delete)：断网沙箱 cap 经 socket 读写
// 自己那份隔离存储。按业务分类:它跟 capstore 住一起,不进机制 bucket。BoundStore 已在构造期绑死到
// 某个 cap 的命名空间(接口里没 kind/id),沙箱填不了别人的。cmd 按需要存储的 cap 挂这四个。

package capstore

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/capsocket"
)

// BoundStore —— 已绑定到某个 cap 的隔离文档存储(无 kind/id)。cmd 用 capstore.Store 绑一个 (kind,id) 后传入。
type BoundStore interface {
	Insert(ctx context.Context, collection string, doc json.RawMessage) (string, error)
	Query(ctx context.Context, collection string, filter json.RawMessage) ([]json.RawMessage, error)
	Count(ctx context.Context, collection string, filter json.RawMessage) (int64, error)
	Delete(ctx context.Context, collection string, filter json.RawMessage) (int64, error)
}

// RegisterOps —— 把 capstore.insert/query/count/delete 挂到 srv,背后是绑死的 store。
func RegisterOps(srv *capsocket.Server, store BoundStore) {
	srv.Handle("capstore.insert", insertHandler(store))
	srv.Handle("capstore.query", queryHandler(store))
	srv.Handle("capstore.count", countHandler(store))
	srv.Handle("capstore.delete", deleteHandler(store))
}

type writeReq struct {
	Collection string          `json:"collection"`
	Doc        json.RawMessage `json:"doc"`
}

type filterReq struct {
	Collection string          `json:"collection"`
	Filter     json.RawMessage `json:"filter"`
}

func insertHandler(store BoundStore) capsocket.Handler {
	return func(ctx context.Context, raw json.RawMessage) (json.RawMessage, error) {
		var req writeReq
		if err := json.Unmarshal(raw, &req); err != nil {
			return nil, fmt.Errorf("capstore.insert: decode: %w", err)
		}
		id, err := store.Insert(ctx, req.Collection, req.Doc)
		if err != nil {
			return nil, fmt.Errorf("capstore.insert: %w", err)
		}
		out, merr := json.Marshal(map[string]string{"id": id})
		if merr != nil {
			return nil, fmt.Errorf("capstore.insert: marshal: %w", merr)
		}
		return out, nil
	}
}

func queryHandler(store BoundStore) capsocket.Handler {
	return func(ctx context.Context, raw json.RawMessage) (json.RawMessage, error) {
		var req filterReq
		if err := json.Unmarshal(raw, &req); err != nil {
			return nil, fmt.Errorf("capstore.query: decode: %w", err)
		}
		docs, err := store.Query(ctx, req.Collection, req.Filter)
		if err != nil {
			return nil, fmt.Errorf("capstore.query: %w", err)
		}
		out, merr := json.Marshal(map[string][]json.RawMessage{"records": docs})
		if merr != nil {
			return nil, fmt.Errorf("capstore.query: marshal: %w", merr)
		}
		return out, nil
	}
}

func countHandler(store BoundStore) capsocket.Handler {
	return func(ctx context.Context, raw json.RawMessage) (json.RawMessage, error) {
		var req filterReq
		if err := json.Unmarshal(raw, &req); err != nil {
			return nil, fmt.Errorf("capstore.count: decode: %w", err)
		}
		n, err := store.Count(ctx, req.Collection, req.Filter)
		if err != nil {
			return nil, fmt.Errorf("capstore.count: %w", err)
		}
		out, merr := json.Marshal(map[string]int64{"count": n})
		if merr != nil {
			return nil, fmt.Errorf("capstore.count: marshal: %w", merr)
		}
		return out, nil
	}
}

func deleteHandler(store BoundStore) capsocket.Handler {
	return func(ctx context.Context, raw json.RawMessage) (json.RawMessage, error) {
		var req filterReq
		if err := json.Unmarshal(raw, &req); err != nil {
			return nil, fmt.Errorf("capstore.delete: decode: %w", err)
		}
		n, err := store.Delete(ctx, req.Collection, req.Filter)
		if err != nil {
			return nil, fmt.Errorf("capstore.delete: %w", err)
		}
		out, merr := json.Marshal(map[string]int64{"deleted": n})
		if merr != nil {
			return nil, fmt.Errorf("capstore.delete: marshal: %w", merr)
		}
		return out, nil
	}
}
