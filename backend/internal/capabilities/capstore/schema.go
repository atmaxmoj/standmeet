// Package capstore —— per-plugin 隔离文档存储,落在**共享的** Postgres 上(不新起库)。
// 每个 connector / MCP capability 拿自己独立的 schema:connector_<id> / mcp_<id>,装时建、
// 卸时 DROP。核心数据在 `public`;plugin schema 一律带**保留前缀**,跟核心结构性区分开。
//
// ⚠️ 危险边界 —— DROP 会 `DROP SCHEMA ... CASCADE`,删掉该 schema 全部行。若 schema 名推导
// 出错、解析成 `public` 或某核心 schema,DROP 就会**删掉核心数据**。所以每次 DROP 必须先过
// schemaName + assertDroppable:非保留前缀 / 空 id / 核心 schema 名一律**拒绝**,绝不 DROP。
// 见 Drop 的三条硬规则。schema 名永远从 host 可信的 (kind,id) 推,绝不取自 plugin 请求。
package capstore

import (
	"fmt"
	"regexp"
	"strings"
)

// Kind —— 存储归属的插件轴。前缀由它定,是"这不是核心 schema"的结构性标记。
type Kind string

const (
	// KindConnector —— 连接器私有存储,schema = connector_<id>。
	KindConnector Kind = "connector"
	// KindMCP —— MCP capability 私有存储,schema = mcp_<id>。
	KindMCP Kind = "mcp"
)

// kindPrefix —— 轴 → 保留前缀。核心 schema 永不带前缀,所以"带前缀" ⟺ "是 plugin 存储、
// 不是核心"。DROP 守卫据此把核心挡在外面。
var kindPrefix = map[Kind]string{
	KindConnector: "connector_",
	KindMCP:       "mcp_",
}

// coreSchemas —— 绝不可 DROP 的核心 schema(belt-and-suspenders;droppableRe 前缀检查已经排除
// 它们,因为它们不带保留前缀,这里再显式拉黑一层)。
var coreSchemas = map[string]bool{
	"public": true, "pg_catalog": true, "information_schema": true, "pg_toast": true,
}

// droppableRe —— 合法可 DROP 的 schema 名:保留前缀 + 纯 [a-z0-9_] 后缀。既挡核心,也堵
// 标识符注入(DDL 里 schema 名只能内插、不能 $1 参数化,所以名字必须先约束死)。
var droppableRe = regexp.MustCompile(`^(connector|mcp)_[a-z0-9_]+$`)

// idSuffixRe —— 把插件 id(可能含 '-'/'.',如 google-calendar / calendar.book)净化后的合法后缀。
var idSuffixRe = regexp.MustCompile(`[^a-z0-9]+`)

// schemaName —— 从 host 可信的 (kind,id) 推出 schema 名。id 净化成 [a-z0-9_]:非法字符折成
// '_',首尾 '_' 去掉。空 id / 净化后为空 / 未知 kind → 错(绝不返回一个可能撞核心的名字)。
func schemaName(kind Kind, id string) (string, error) {
	prefix, ok := kindPrefix[kind]
	if !ok {
		return "", fmt.Errorf("capstore: unknown kind %q", kind)
	}
	suffix := strings.Trim(idSuffixRe.ReplaceAllString(strings.ToLower(id), "_"), "_")
	if suffix == "" {
		return "", fmt.Errorf("capstore: empty schema id for kind %q", kind)
	}
	name := prefix + suffix
	if derr := assertDroppable(name); derr != nil {
		return "", derr // 推导出的名字连守卫都过不了:属逻辑错,早失败
	}
	return name, nil
}

// assertDroppable —— DROP 前的核心安全守卫:名字必须匹配保留前缀 + 纯净后缀,且不在核心
// 拉黑名单里。任何不合规的名字 → 错,**绝不 DROP**。这是"删库前的最后一道闸"。
func assertDroppable(name string) error {
	if coreSchemas[name] {
		return fmt.Errorf("capstore: refuse to drop core schema %q", name)
	}
	if !droppableRe.MatchString(name) {
		return fmt.Errorf("capstore: refuse non-plugin schema %q (no reserved prefix)", name)
	}
	return nil
}
