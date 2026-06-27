// Package openapi —— 通用 openapi 连接器的执行核（spec 解析 + JSONata 绑定 + HTTP 代调）。
//
// 这是「连接器归一化」的心脏：任何 openapi 连接器——内置 gcal、上传的 SendGrid——都是
// 「一份 OpenAPI 3.0 spec + 一份 JSONata 绑定」，跑这同一个 Runtime。本包是 schemaless-JSON
// 边界（任意 SaaS 的请求/响应都是任意 JSON），所以这里——且只有这里——`any` 合法（golangci
// 对本路径豁免 forbidigo，同 MCP/postgres 边界）。包外的契约适配器全程用**带类型**的入参/
// 出参（Call 内部做 JSON round-trip），`any` 不外泄。
package openapi

import "errors"

// 装配期（POST /connectors 校验时）的 sentinel：回 admin 当 4xx 友好提示。
var (
	ErrSpecNoOperations       = errors.New("openapi spec has no operations (paths)")
	ErrSpecNoServer           = errors.New("openapi spec has no server url")
	ErrBindingUnknownOp       = errors.New("binding references an operationId not in the spec")
	ErrBindingUnknownCategory = errors.New("binding declares an unknown category")
	ErrBindingIncomplete      = errors.New("binding does not map all required contract operations")
	ErrBindingBadJSONata      = errors.New("binding has an invalid JSONata expression")
)
