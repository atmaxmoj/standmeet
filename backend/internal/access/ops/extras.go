// extras.go —— 一张码上,**别的能力**自管的 per-code 配置。
//
// 起因是 max_bookings:它是 booker 自己存的 per-code 配额(内核的 access_code 表里没有
// 这一列),但 owner 眼里它就是"这张码"上的一个数字,发码时一起填、列表里一起看。
//
// access 不认识 booker,连字段叫什么都不认识:它拿到的是一个口子 —— 声明期问"你要在码
// 的载荷里占哪些字段",出站时问"这张码上你那几个字段是什么值",入站时把原始入参整份递过去
// 让它自己挑。组装根把每个声明了 per-code 配置的能力接上来。
//
// 读写都是 best-effort:那是另一个能力的存储,取不到不该让整张码打不开,写不进也不该挡住
// 发码 —— 码已经建好了,配额可以再设。

package ops

import (
	"context"
	"encoding/json"
	"maps"
)

// CodeExtras —— 能力在一张码上占的字段。
type CodeExtras interface {
	// Fields —— 字段名 → 这个字段的 JSON Schema 片段。声明期调一次。
	Fields() map[string]json.RawMessage
	// Read —— 这张码上那几个字段的值。取不到就少几个键。
	Read(ctx context.Context, codeID string) map[string]json.RawMessage
	// Write —— 从原始入参里挑自己的字段写下去。没提到就不动。
	Write(ctx context.Context, codeID string, args json.RawMessage)
}

// noExtras —— 没有任何能力声明 per-code 配置时的那个"没有"。
type noExtras struct{}

func (noExtras) Fields() map[string]json.RawMessage {
	return map[string]json.RawMessage{}
}

func (noExtras) Read(_ context.Context, _ string) map[string]json.RawMessage {
	return map[string]json.RawMessage{}
}

func (noExtras) Write(_ context.Context, _ string, _ json.RawMessage) {}

//nolint:ireturn // 这个口子本来就是接口:没接上任何能力时给一个"什么都没有"
func extrasOr(e CodeExtras) CodeExtras {
	if e == nil {
		return noExtras{}
	}
	return e
}

// withExtraFields —— 把能力声明的字段并进一份 schema 的 properties。
func withExtraFields(base json.RawMessage, fields map[string]json.RawMessage) json.RawMessage {
	if len(fields) == 0 {
		return base
	}
	var schema map[string]json.RawMessage
	if err := json.Unmarshal(base, &schema); err != nil {
		return base
	}
	merged, err := json.Marshal(mergedProperties(schema["properties"], fields))
	if err != nil {
		return base
	}
	schema["properties"] = merged
	return remarshal(schema, base)
}

// mergedProperties —— 原有的属性 + 能力加的那几个。
func mergedProperties(
	base json.RawMessage, fields map[string]json.RawMessage,
) map[string]json.RawMessage {
	props := map[string]json.RawMessage{}
	if err := json.Unmarshal(base, &props); err != nil {
		props = map[string]json.RawMessage{}
	}
	maps.Copy(props, fields)
	return props
}

// withExtraValues —— 把能力那几个字段的值并进一份已经序列化好的载荷。
func withExtraValues(payload json.RawMessage, values map[string]json.RawMessage) json.RawMessage {
	if len(values) == 0 {
		return payload
	}
	var obj map[string]json.RawMessage
	if err := json.Unmarshal(payload, &obj); err != nil {
		return payload
	}
	maps.Copy(obj, values)
	return remarshal(obj, payload)
}

// remarshal —— 编不回去就退回原样:多几个字段不值得让整个操作失败。
func remarshal(obj map[string]json.RawMessage, fallback json.RawMessage) json.RawMessage {
	out, err := json.Marshal(obj)
	if err != nil {
		return fallback
	}
	return out
}
