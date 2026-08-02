// capability_storage.go —— 一个能力**自己的**存储和配置,绑死在它的命名空间上。
//
// 绑死是构造期做的:接口里没有 kind / id,所以沙箱那侧根本没有"填别人的表"这个路径 ——
// 隔离是构造出来的,不是每次请求校验出来的。schema 名从**宿主信任的 id** 派生
// (mcp_<id>),永远不从插件的请求里取。

package main

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/capabilities/capconfig"
	"github.com/atmaxmoj/standmeet/internal/capabilities/capstore"
	"github.com/atmaxmoj/standmeet/internal/capabilities/mcpplugin"
	capstoreroutes "github.com/atmaxmoj/standmeet/internal/routes/capstore"
)

// boundCapStore —— 通用 capstore.Store 绑到某个能力的命名空间。
type boundCapStore struct {
	store *capstore.Store
	kind  capstore.Kind
	id    string
}

func (b boundCapStore) Insert(
	ctx context.Context, collection string, doc json.RawMessage,
) (string, error) {
	id, err := b.store.Insert(ctx, b.kind, b.id, collection, doc)
	if err != nil {
		return "", fmt.Errorf("capstore insert: %w", err)
	}
	return id, nil
}

func (b boundCapStore) Query(
	ctx context.Context, collection string, filter json.RawMessage,
) ([]json.RawMessage, error) {
	docs, err := b.store.Query(ctx, b.kind, b.id, collection, filter)
	if err != nil {
		return nil, fmt.Errorf("capstore query: %w", err)
	}
	return docs, nil
}

func (b boundCapStore) Count(
	ctx context.Context, collection string, filter json.RawMessage,
) (int64, error) {
	n, err := b.store.Count(ctx, b.kind, b.id, collection, filter)
	if err != nil {
		return 0, fmt.Errorf("capstore count: %w", err)
	}
	return n, nil
}

func (b boundCapStore) Delete(
	ctx context.Context, collection string, filter json.RawMessage,
) (int64, error) {
	n, err := b.store.Delete(ctx, b.kind, b.id, collection, filter)
	if err != nil {
		return 0, fmt.Errorf("capstore delete: %w", err)
	}
	return n, nil
}

// QueryRecords / DeleteByID —— 带记录 id 的读与按 id 删。能力够不到自己记录的 id,
// 就必然在别处长出一份副本(见 capstoreroutes.BoundStore 的说明)。
func (b boundCapStore) QueryRecords(
	ctx context.Context, collection string, filter json.RawMessage,
) ([]capstoreroutes.BoundRecord, error) {
	recs, err := b.store.QueryWithIDs(ctx, b.kind, b.id, collection, filter)
	if err != nil {
		return nil, fmt.Errorf("capstore query records: %w", err)
	}
	out := make([]capstoreroutes.BoundRecord, 0, len(recs))
	for i := range recs {
		out = append(out, capstoreroutes.BoundRecord{ID: recs[i].ID, Doc: recs[i].Doc})
	}
	return out, nil
}

func (b boundCapStore) DeleteByID(
	ctx context.Context, collection, recordID string,
) (int64, error) {
	n, err := b.store.DeleteByID(ctx, b.kind, b.id, collection, recordID)
	if err != nil {
		return 0, fmt.Errorf("capstore delete by id: %w", err)
	}
	return n, nil
}

// boundCapConfig —— 绑死 (kind, id, 声明) 的配置读口:沙箱只能问"我的配置"。
type boundCapConfig struct {
	cfg  *capconfig.Store
	decl []mcpplugin.ConfigField
}

func capConfigFor(store *capstore.Store, capID string) *capconfig.Store {
	return capconfig.New(store, capstore.KindMCP, capID)
}

func (b boundCapConfig) Values(
	ctx context.Context, ownerID string,
) (map[string]json.RawMessage, error) {
	values, err := b.cfg.Values(ctx, ownerID, b.decl)
	if err != nil {
		return nil, fmt.Errorf("capability config: %w", err)
	}
	return values, nil
}
