// Package reachback —— host 拥有的"固定词表" reach-back 网关。#135 constrained-reachback。
//
// 一个断网沙箱能力经它绑进沙箱的 socket 只能**调**这套封闭 op,**加不了新 op**(不像旧的
// Register<Cap>Socket 让每个 cap 自定义 book/list_slots 这类私有动词)。能力的业务逻辑住在
// 它自己的沙箱二进制里;它要连接器/自己的存储/owner 元数据,只能走这几个通用 op 伸手。
//
// 隔离:CapStore 在构造期就绑死到某个 cap 的 schema(接口里没有 kind/id 字段),所以一个 cap
// 的 socket 物理上够不到别的 cap 或核心的存储。session(owner/conversation)由 host 种在
// tool-call `_meta` 上、插件转发进请求 —— 不信任 LLM 填的值。
package reachback

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/capsocket"
)

// ConnectorInvoker —— 连接器按名调用(category+verb+args→json)。composition root 注入
// connector.Slots。
type ConnectorInvoker interface {
	Invoke(
		ctx context.Context, ownerID, category, verb string, args json.RawMessage,
	) (json.RawMessage, error)
}

// CapStore —— **已绑定到某个 cap** 的隔离文档存储。接口里没有 kind/id:哪个 cap 在构造期就
// 绑死,插件填不了别人的命名空间。
type CapStore interface {
	Insert(ctx context.Context, collection string, doc json.RawMessage) (string, error)
	Query(ctx context.Context, collection string, filter json.RawMessage) ([]json.RawMessage, error)
	Count(ctx context.Context, collection string, filter json.RawMessage) (int64, error)
}

// OwnerMeta —— 读白名单 owner 字段(如时区)。非白名单字段一律拒(不泄露任意 owner 数据)。
type OwnerMeta interface {
	Meta(ctx context.Context, ownerID, field string) (string, error)
}

// Deps —— 一个 cap 的 gateway 依赖(composition root 注入;CapStore 已绑到本 cap)。
type Deps struct {
	Connectors ConnectorInvoker
	Store      CapStore
	Owner      OwnerMeta
}

// Register —— 把封闭词表挂到该 cap 的 socket 上。这是**唯一**注册 op 的地方(词表封闭:
// 想加 op 只能改这里,插件端加不了)。
func (d *Deps) Register(srv *capsocket.Server) {
	srv.Handle("connector.invoke", d.connectorInvoke)
	srv.Handle("capstore.insert", d.capstoreInsert)
	srv.Handle("capstore.query", d.capstoreQuery)
	srv.Handle("capstore.count", d.capstoreCount)
	srv.Handle("owner.meta", d.ownerMeta)
}

// json.RawMessage(24B)排在 string 之后 —— slice 的 len/cap 无指针,放末尾缩小 GC 指针扫描区
// (fieldalignment)。字段顺序不影响 unmarshal。

type connectorInvokeReq struct {
	OwnerID  string          `json:"owner_id"`
	Category string          `json:"category"`
	Verb     string          `json:"verb"`
	Args     json.RawMessage `json:"args"`
}

func (d *Deps) connectorInvoke(ctx context.Context, raw json.RawMessage) (json.RawMessage, error) {
	var req connectorInvokeReq
	if err := json.Unmarshal(raw, &req); err != nil {
		return nil, fmt.Errorf("reachback connector.invoke: decode: %w", err)
	}
	out, err := d.Connectors.Invoke(ctx, req.OwnerID, req.Category, req.Verb, req.Args)
	if err != nil {
		return nil, fmt.Errorf("reachback connector.invoke: %w", err)
	}
	return out, nil
}

type capstoreWriteReq struct {
	Collection string          `json:"collection"`
	Doc        json.RawMessage `json:"doc"`
}

func (d *Deps) capstoreInsert(ctx context.Context, raw json.RawMessage) (json.RawMessage, error) {
	var req capstoreWriteReq
	if err := json.Unmarshal(raw, &req); err != nil {
		return nil, fmt.Errorf("reachback capstore.insert: decode: %w", err)
	}
	id, err := d.Store.Insert(ctx, req.Collection, req.Doc)
	if err != nil {
		return nil, fmt.Errorf("reachback capstore.insert: %w", err)
	}
	out, merr := json.Marshal(map[string]string{"id": id})
	if merr != nil {
		return nil, fmt.Errorf("reachback capstore.insert: marshal: %w", merr)
	}
	return out, nil
}

type capstoreQueryReq struct {
	Collection string          `json:"collection"`
	Filter     json.RawMessage `json:"filter"`
}

func (d *Deps) capstoreQuery(ctx context.Context, raw json.RawMessage) (json.RawMessage, error) {
	var req capstoreQueryReq
	if err := json.Unmarshal(raw, &req); err != nil {
		return nil, fmt.Errorf("reachback capstore.query: decode: %w", err)
	}
	docs, err := d.Store.Query(ctx, req.Collection, req.Filter)
	if err != nil {
		return nil, fmt.Errorf("reachback capstore.query: %w", err)
	}
	out, merr := json.Marshal(map[string][]json.RawMessage{"records": docs})
	if merr != nil {
		return nil, fmt.Errorf("reachback capstore.query: marshal: %w", merr)
	}
	return out, nil
}

func (d *Deps) capstoreCount(ctx context.Context, raw json.RawMessage) (json.RawMessage, error) {
	var req capstoreQueryReq
	if err := json.Unmarshal(raw, &req); err != nil {
		return nil, fmt.Errorf("reachback capstore.count: decode: %w", err)
	}
	n, err := d.Store.Count(ctx, req.Collection, req.Filter)
	if err != nil {
		return nil, fmt.Errorf("reachback capstore.count: %w", err)
	}
	out, merr := json.Marshal(map[string]int64{"count": n})
	if merr != nil {
		return nil, fmt.Errorf("reachback capstore.count: marshal: %w", merr)
	}
	return out, nil
}

// allowedOwnerFields —— owner.meta 可读的白名单字段。词表外一律拒。
var allowedOwnerFields = map[string]bool{"timezone": true}

type ownerMetaReq struct {
	OwnerID string `json:"owner_id"`
	Field   string `json:"field"`
}

func (d *Deps) ownerMeta(ctx context.Context, raw json.RawMessage) (json.RawMessage, error) {
	var req ownerMetaReq
	if err := json.Unmarshal(raw, &req); err != nil {
		return nil, fmt.Errorf("reachback owner.meta: decode: %w", err)
	}
	if !allowedOwnerFields[req.Field] {
		return nil, fmt.Errorf("reachback owner.meta: field %q not allowed", req.Field)
	}
	val, err := d.Owner.Meta(ctx, req.OwnerID, req.Field)
	if err != nil {
		return nil, fmt.Errorf("reachback owner.meta: %w", err)
	}
	out, merr := json.Marshal(map[string]string{"value": val})
	if merr != nil {
		return nil, fmt.Errorf("reachback owner.meta: marshal: %w", merr)
	}
	return out, nil
}
