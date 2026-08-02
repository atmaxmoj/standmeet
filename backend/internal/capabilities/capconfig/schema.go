// schema.go —— 把一个配置项的**声明**翻成它在入参里的 JSON Schema 片段。
//
// 翻译只有这一处。手写那一份的问题不是麻烦,是它跟声明是两个事实:booker 的
// max_bookings 曾经在组装根手写成 `{"type":["integer","null"],...}`,而它的类型、说明、
// 取值范围都已经在声明里写着了 —— 两份东西说同一件事,就总有一天说得不一样。

package capconfig

import (
	"encoding/json"
	"strconv"
	"strings"

	"github.com/atmaxmoj/standmeet/internal/capabilities/mcpplugin"
)

// jsonTypeOf —— 声明的类型 → JSON Schema 的类型。表外的类型不该存在
// (mcpplugin 的常量是全集),兜底成 string 而不是崩:一个显示不对的表单
// 好过一台起不来的实例。
func jsonTypeOf(t string) string {
	switch t {
	case mcpplugin.ConfigTypeInt:
		return "integer"
	case mcpplugin.ConfigTypeBool:
		return "boolean"
	case mcpplugin.ConfigTypeStringList:
		return "array"
	default: // string / time 都是字符串
		return "string"
	}
}

// schemaOf —— 一个字段的 schema 片段。
//
// 类型永远带 "null":码上的字段是可选的,"不设"跟"设成 0"是两件事(0 会被读成已用尽)。
func schemaOf(f *mcpplugin.ConfigField) json.RawMessage {
	parts := []string{
		`"type":["` + jsonTypeOf(f.Type) + `","null"]`,
		`"description":` + quote(f.Description),
	}
	if f.Type == mcpplugin.ConfigTypeStringList {
		parts = append(parts, `"items":{"type":"string"}`)
	}
	if f.Min != nil {
		parts = append(parts, `"minimum":`+strconv.Itoa(*f.Min))
	}
	if f.Max != nil {
		parts = append(parts, `"maximum":`+strconv.Itoa(*f.Max))
	}
	return json.RawMessage("{" + strings.Join(parts, ",") + "}")
}

// quote —— 说明文字进 JSON 字面量。编码不了就给个空串,schema 仍然合法。
func quote(s string) string {
	b, err := json.Marshal(s)
	if err != nil {
		return `""`
	}
	return string(b)
}
