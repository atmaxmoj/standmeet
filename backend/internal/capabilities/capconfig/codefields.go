// codefields.go —— 所有能力在**一张邀请码**上占的字段,合成一个通用面。
//
// owner 眼里那就是"这张码"上的几个设置:发码时一起填,列表里一起看。access 域不认识任何一个
// 能力,所以它只留了一个口子(能力在码上占哪些字段、怎么读、怎么写);这里把每个能力
// manifest 里的 CodeConfig 声明拼成那个口子的唯一实现。
//
// 之前这个实现是**per-capability 手写**的:booker 一个适配器 + 一个自己的存储 + 一个自己的
// schema 片段。第二个能力想在码上放东西,就得再抄一份。现在能力只写声明,一行都不用抄。

package capconfig

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"maps"

	"github.com/atmaxmoj/standmeet/internal/capabilities/mcpplugin"
)

// CodeCap —— 一个能力在码上的声明 + 它自己的存储。
type CodeCap struct {
	Store *Store
	CapID string
	Decl  []mcpplugin.ConfigField
}

// CodeFields —— 合起来的那一面。实现 access 那个口子的三个方法(结构化满足,不 import access)。
//
// log 用来把写失败说出来。这一层没有错误通道(发码本身不该因为一个能力的存储挂了而失败),
// 所以失败必须留下痕迹 —— 悄悄咽掉的话,owner 只会看到配额没生效,查不出为什么。
type CodeFields struct {
	log   *slog.Logger
	byKey map[string]CodeCap
	caps  []CodeCap
}

// NewCodeFields —— 把各能力的声明合起来。
//
// 两个能力占同一个字段名 → error(组装根据此在启动时炸)。两份声明抢一个键,写下去的值归谁、
// 读回来的是谁的,没有对的答案 —— 那不该等到 owner 发现配额没生效才暴露。
func NewCodeFields(log *slog.Logger, caps []CodeCap) (*CodeFields, error) {
	byKey := map[string]CodeCap{}
	for _, c := range caps {
		for i := range c.Decl {
			key := c.Decl[i].Key
			if prev, taken := byKey[key]; taken {
				return nil, fmt.Errorf(
					"%w: %q claimed by both %q and %q",
					ErrFieldTaken, key, prev.CapID, c.CapID)
			}
			byKey[key] = c
		}
	}
	return &CodeFields{log: log, byKey: byKey, caps: caps}, nil
}

// Fields —— 字段名 → JSON Schema 片段。发码入参的 schema 按它长出来。
func (f *CodeFields) Fields() map[string]json.RawMessage {
	out := make(map[string]json.RawMessage, len(f.byKey))
	for _, c := range f.caps {
		for i := range c.Decl {
			out[c.Decl[i].Key] = schemaOf(&c.Decl[i])
		}
	}
	return out
}

// Read —— 这张码上各能力的值。某个能力读不出来就少几个键 —— 一个能力的存储出问题,
// 不该让整张码打不开。
func (f *CodeFields) Read(ctx context.Context, codeID string) map[string]json.RawMessage {
	out := map[string]json.RawMessage{}
	for _, c := range f.caps {
		values, err := c.Store.ValuesScoped(ctx, CodeScope(codeID), c.Decl)
		if err != nil {
			f.log.Warn("code field read", "cap", c.CapID, "code", codeID, "err", err)
			continue
		}
		maps.Copy(out, values)
	}
	return out
}

// Write —— 从原始入参里挑各能力自己的字段写下去。没提到的键不动。
//
// 写不进不挡住发码本身:码已经建好了,配额可以再设。但失败要**说出来** —— 这一层没有错误
// 通道,咽掉的话 owner 只看到配额没生效,查不出为什么。
func (f *CodeFields) Write(ctx context.Context, codeID string, args json.RawMessage) {
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(args, &raw); err != nil {
		f.log.Warn("code field write: decode args", "code", codeID, "err", err)
		return
	}
	for _, c := range f.caps {
		mine := pick(&c, raw)
		if len(mine) == 0 {
			continue
		}
		if err := c.Store.SetScoped(ctx, CodeScope(codeID), c.Decl, mine); err != nil {
			f.log.Warn("code field write", "cap", c.CapID, "code", codeID, "err", err)
		}
	}
}

// pick —— 入参里属于这个能力的那几个键。
func pick(c *CodeCap, raw map[string]json.RawMessage) map[string]json.RawMessage {
	mine := map[string]json.RawMessage{}
	for i := range c.Decl {
		if v, ok := raw[c.Decl[i].Key]; ok {
			mine[c.Decl[i].Key] = v
		}
	}
	return mine
}
