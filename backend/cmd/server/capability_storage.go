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
	"strings"

	"github.com/atmaxmoj/standmeet/internal/capabilities/capconfig"
	"github.com/atmaxmoj/standmeet/internal/capabilities/capstore"
	"github.com/atmaxmoj/standmeet/internal/capabilities/mcpplugin"
	capstoreroutes "github.com/atmaxmoj/standmeet/internal/routes/capstore"
)

// wireCapabilityStorage —— 启动期给每个**需要**存储的能力 provision 一次它自己的 schema
// (mcp_<id>),之后所有接线从这里取。
//
// 一次而不是每个接线点各来一次:provision 是 DDL,重复跑既慢又让"这个能力有没有存储"这个
// 事实散在四处各判一遍。
func wireCapabilityStorage(ctx context.Context, d *runtimeDeps) {
	manifests := builtinManifests()
	for i := range manifests {
		m := &manifests[i]
		if !needsStorage(m) {
			continue
		}
		store := capstore.New(d.db)
		if err := store.Provision(ctx, capstore.KindMCP, m.ID); err != nil {
			d.log.Error("capability storage provision", "cap", m.ID, "err", err)
			continue
		}
		d.capStores[m.ID] = store
	}
}

// capabilityStorage —— 这个能力自己的隔离存储。没有(不需要 / provision 失败)→ nil。
//
// 四件事都落在同一份存储上:沙箱自己读写(capstore.*)、owner 的配置(Config)、码上的字段
// (CodeConfig)、用量计数(Quota)。判定只有 needsStorage 这一处 —— 散开写的后果是漏记条件
// 的那一处到运行时才发现:表不存在。
func capabilityStorage(d *runtimeDeps, m *mcpplugin.Manifest) *capstore.Store {
	return d.capStores[m.ID]
}

func needsStorage(m *mcpplugin.Manifest) bool {
	return wantsAny(m, "capstore.") ||
		len(m.Config) > 0 || len(m.CodeConfig) > 0 || m.Quota.Usable()
}

// wantsAny —— 这个能力点过某个前缀下的 host op 没有。
func wantsAny(m *mcpplugin.Manifest, prefix string) bool {
	for _, name := range hostOpsOf(m) {
		if strings.HasPrefix(name, prefix) {
			return true
		}
	}
	return false
}

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
