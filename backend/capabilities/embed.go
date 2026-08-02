// Package capabilities —— 随产品发的内建能力**声明**,自成一个顶层目录(跟 Dockerfile 平级),
// 不埋在 internal/ 里。跟 backend/connectors/ 同形:两根插件轴,一样的地址结构。
//
// 每个子目录是一个能力,只有数据(manifest.yaml),go:embed 进二进制,拉起时经通用的
// mcpplugin 装载路径装配 —— 宿主不 import 任何插件代码,契约只有这份 manifest + 运行时
// MCP 协议。内建和第三方走**完全同一条** sandbox_stdio 路径,只是 manifest 的来源不同。
//
// 这些声明以前是组装根里的 Go 字面量:能力的身份、它点了哪些
// host op、它在码上占哪个字段,全长在组装根里 —— 而组装根本该只做装配。
package capabilities

import "embed"

// builtinFS —— 每个子目录一个内建能力。逐个列出,免得把本目录的 .go 文件也 embed 进去。
//
//go:embed ask_visitor calendar.book corpus.retrieval mail.send summarize_conversation
var builtinFS embed.FS
