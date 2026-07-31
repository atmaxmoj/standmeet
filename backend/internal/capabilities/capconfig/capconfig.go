// Package capconfig —— 能力的可配置项:**通用**的存取,host 不认识任何一个字段的含义。
//
// 一个能力在自己的 manifest 里声明有哪些配置项(mcpplugin.ConfigField:键、类型、默认值),
// owner 在面板上填,值存进**这个能力自己的隔离存储**(capstore 的一个固定 collection)。
// 读的时候拿声明的默认值兜底。
//
// host 这一侧从头到尾没有一个业务词:没有 "working_hours"、没有 "booking"。
// 它只知道"某个能力声明了一组键,owner 覆盖了其中几个"。
//
// 为什么要有这个包:在此之前能力想要"可设置"是没有路的,只能在 host 手写一整套 ——
// 实体、默认值、读写、路由、表单。手写那份必然飘(booker 的策略就已经飘了:
// host 说到 18:00、缓冲 15,沙箱按 17:00、缓冲 0)。这跟当初补 OwnerTools 是同一个洞。
package capconfig

import (
	"context"
	"encoding/json"
	"fmt"
	"maps"

	"github.com/atmaxmoj/standmeet/internal/capabilities/capstore"
	"github.com/atmaxmoj/standmeet/internal/capabilities/mcpplugin"
)

// collection —— 配置值在能力自己的隔离存储里用的固定 collection 名。
// 固定而不是每个能力自选:host 要能通用地读写它。
const collection = "capconfig"

// ownerKey —— 配置文档里标识 owner 的键(单 owner 实例也照写,多租户时天然可用)。
const ownerKey = "owner_id"

// Store —— **绑死到一个能力**的配置读写口。
//
// 构造期就定死 (kind, capID) —— 跟 capstore 的 BoundStore 同形:调用方拿到的口子只能操作
// 这一个能力的配置,填不了别人的 id。
type Store struct {
	store *capstore.Store
	kind  capstore.Kind
	capID string
}

// New —— 把底层 capstore 绑到某个能力的命名空间上。
func New(store *capstore.Store, kind capstore.Kind, capID string) *Store {
	return &Store{store: store, kind: kind, capID: capID}
}

// Field —— 一个配置项的**声明 + 当前值**,面板照它渲染一行。
type Field struct {
	Key         string
	Label       string
	Type        string
	Description string
	// Value —— 当前生效的值(JSON 字面量)。owner 没设过就是声明里的默认值。
	Value string
	// Default —— 声明里的默认值(JSON 字面量),面板据此显示"恢复默认"。
	Default string
	// Overridden —— owner 是否显式设过。false = 现在用的是默认值。
	Overridden bool
}

// Get —— 某能力当前的全部配置项(声明 ∪ owner 覆盖)。
//
// 以**声明**为准:声明里没有的键即使存过也不返回 —— 能力删掉一个配置项之后,
// 旧值不该继续从面板上冒出来。
func (s *Store) Get(
	ctx context.Context, ownerID string, decl []mcpplugin.ConfigField,
) ([]Field, error) {
	stored, err := s.stored(ctx, ownerID)
	if err != nil {
		return nil, err
	}
	out := make([]Field, 0, len(decl))
	for i := range decl {
		f := Field{
			Key: decl[i].Key, Label: decl[i].Label, Type: decl[i].Type,
			Description: decl[i].Description, Default: decl[i].Default,
			Value: decl[i].Default,
		}
		if v, ok := stored[decl[i].Key]; ok {
			f.Value, f.Overridden = string(v), true
		}
		out = append(out, f)
	}
	return out, nil
}

// Values —— 只要键值(能力实现读它)。同样以声明为准、默认值兜底。
func (s *Store) Values(
	ctx context.Context, ownerID string, decl []mcpplugin.ConfigField,
) (map[string]json.RawMessage, error) {
	fields, err := s.Get(ctx, ownerID, decl)
	if err != nil {
		return nil, err
	}
	out := make(map[string]json.RawMessage, len(fields))
	for i := range fields {
		out[fields[i].Key] = json.RawMessage(fields[i].Value)
	}
	return out, nil
}

// Set —— 覆盖 owner 对某能力的配置(单例文档:先删旧的,再插新的)。
//
// 只接受声明里有的键;声明外的键直接拒 —— 面板发来一个不存在的字段是调用方的错,
// 不该悄悄存下来变成永远没人读的垃圾。
func (s *Store) Set(
	ctx context.Context, ownerID string,
	decl []mcpplugin.ConfigField, values map[string]json.RawMessage,
) error {
	if err := check(decl, values); err != nil {
		return err
	}
	doc, merr := buildDoc(ownerID, values)
	if merr != nil {
		return merr
	}
	if err := s.clear(ctx, ownerID); err != nil {
		return err
	}
	if _, err := s.store.Insert(ctx, s.kind, s.capID, collection, doc); err != nil {
		return fmt.Errorf("capconfig insert: %w", err)
	}
	return nil
}

// check —— 写之前的全部把关:键必须是声明过的,值必须符合声明。
// 声明外的键不该悄悄存下来变成永远没人读的垃圾。
func check(decl []mcpplugin.ConfigField, values map[string]json.RawMessage) error {
	declared := map[string]bool{}
	for i := range decl {
		declared[decl[i].Key] = true
	}
	for k := range values {
		if !declared[k] {
			return fmt.Errorf("%w: %q", ErrUnknownField, k)
		}
	}
	return validate(decl, values)
}

// stored —— owner 显式设过的那些键。没设过 → 空表(不是错)。
func (s *Store) stored(
	ctx context.Context, ownerID string,
) (map[string]json.RawMessage, error) {
	filter, ferr := json.Marshal(map[string]string{ownerKey: ownerID})
	if ferr != nil {
		return nil, fmt.Errorf("capconfig filter: %w", ferr)
	}
	recs, err := s.store.Query(ctx, s.kind, s.capID, collection, filter)
	if err != nil {
		return nil, fmt.Errorf("capconfig query: %w", err)
	}
	if len(recs) == 0 {
		return map[string]json.RawMessage{}, nil
	}
	var doc map[string]json.RawMessage
	if uerr := json.Unmarshal(recs[0], &doc); uerr != nil {
		return nil, fmt.Errorf("capconfig decode: %w", uerr)
	}
	delete(doc, ownerKey)
	return doc, nil
}

func (s *Store) clear(ctx context.Context, ownerID string) error {
	filter, ferr := json.Marshal(map[string]string{ownerKey: ownerID})
	if ferr != nil {
		return fmt.Errorf("capconfig filter: %w", ferr)
	}
	if _, err := s.store.Delete(ctx, s.kind, s.capID, collection, filter); err != nil {
		return fmt.Errorf("capconfig clear: %w", err)
	}
	return nil
}

func buildDoc(ownerID string, values map[string]json.RawMessage) ([]byte, error) {
	doc := make(map[string]json.RawMessage, len(values)+1)
	maps.Copy(doc, values)
	id, ierr := json.Marshal(ownerID)
	if ierr != nil {
		return nil, fmt.Errorf("capconfig owner id: %w", ierr)
	}
	doc[ownerKey] = id
	out, merr := json.Marshal(doc)
	if merr != nil {
		return nil, fmt.Errorf("capconfig encode: %w", merr)
	}
	return out, nil
}
