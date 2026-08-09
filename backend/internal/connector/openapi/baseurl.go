// baseurl.go —— owner 手填的 base URL,在**边界**上并进 spec。
//
// 真厂商文档常常不带可用的 `servers`(Cal.com v2 写的是显式的 `"servers": []`),而摄入闸要求
// 它必须有(ingest.go)。owner 唯一的出路本来是手改 vendor 的文件 —— 那正是 connector-assembly
// check 2 明确禁止的事(F-C-22)。
//
// **为什么是「归一化」而不是「往下游穿一个 override」:** 校验、装配、运行时、出站 SSRF 静态
// 校验、凭据表单派生 —— 这五处都读同一份 spec 字节。多一个 override 参数就要在五处都记得它
// 存在,漏一处就是「装配时有 base URL、运行时没有」这种只在真调用时才炸的洞。在入口把它并进
// 文档,下游全都看到一份**普通的 spec**,一个字都不用改。
//
// **幂等由结构保证:** 设一个 map 键,而不是往文本里插一段。spec 本来就有 `servers` 时是覆盖,
// 绝不会产出两个 `servers` 键 —— 手工插一段正是这么炸的(重复键,YAML 解析器合法地拒绝)。

package openapi

import (
	"errors"
	"fmt"
	"strings"

	yaml "go.yaml.in/yaml/v3"
)

// errSpecNotAMapping —— 文档顶层不是一个映射(比如是个列表或标量),没有地方安放 servers。
var errSpecNotAMapping = errors.New("the spec is not an object at its top level")

// ApplyBaseURL —— 把 owner 填的 base URL 写进 spec 的 `servers`,返回归一化后的文档字节。
// baseURL 为空 → 原样返回(零改动,连解析都不做)。JSON 也走这条路:YAML 是 JSON 的超集,
// 解出来是同一个 map,回写成 YAML 后 ParseSpec 一样认。
func ApplyBaseURL(raw []byte, baseURL string) ([]byte, error) {
	trimmed := strings.TrimSpace(baseURL)
	if trimmed == "" {
		return raw, nil
	}
	var doc map[string]any
	if err := yaml.Unmarshal(raw, &doc); err != nil {
		return nil, fmt.Errorf("apply base url: %w", err)
	}
	if doc == nil {
		return nil, fmt.Errorf("apply base url: %w", errSpecNotAMapping)
	}
	doc["servers"] = []any{map[string]any{"url": trimmed}}
	out, merr := yaml.Marshal(doc)
	if merr != nil {
		return nil, fmt.Errorf("apply base url: %w", merr)
	}
	return out, nil
}
