// runtime_query.go —— 把绑定的 query JSONata 渲染成 URL 查询串。拆出 runtime.go 守 max-lines。
//
// 为什么需要这一段：有些 SaaS 把动作的一半放在查询参数里。Google Calendar 的「通知与会者」
// 就是 `?sendUpdates=all` —— 建会和取消都靠它，请求体里没有任何地方能表达。绑定语言原本
// 只有 op/request/response，这个开关于是在连接器外置时无声无息地消失了（F-B-7）。

package openapi

import (
	"net/url"
	"strconv"
)

// requestURL —— base + 路径（{param} 替换）+ 查询串。一个操作的目标地址在这里拼齐。
func (r *Runtime) requestURL(bo *boundOp, input any) (string, error) {
	query, err := renderQuery(&bo.binding, input)
	if err != nil {
		return "", err
	}
	return r.baseURL + substitutePath(bo.resolved.Path, input) + query, nil
}

// renderQuery —— query JSONata → `?a=1&b=2`（已编码）。空/无 → 空串。值为 null 或空串的键
// 直接丢掉：「有邮箱才通知」这类条件写成 JSONata 三元式，求值成空就是不带这个参数。
func renderQuery(ob *opBinding, input any) (string, error) {
	m, err := ob.evalQuery(input)
	if err != nil {
		return "", err
	}
	values := url.Values{}
	for k, v := range m {
		if s := queryValue(v); s != "" {
			values.Set(k, s)
		}
	}
	if len(values) == 0 {
		return "", nil
	}
	return "?" + values.Encode(), nil
}

// float64Bits —— JSON 数字解出来就是 float64；格式化时按原精度写回。
const float64Bits = 64

// queryValue —— 查询参数值只收标量；null / 对象 / 数组 → 空串（= 不带这个键）。
func queryValue(v any) string {
	switch t := v.(type) {
	case string:
		return t
	case bool:
		return strconv.FormatBool(t)
	case float64:
		return strconv.FormatFloat(t, 'f', -1, float64Bits)
	default:
		return ""
	}
}
