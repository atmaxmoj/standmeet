package builtins

import "embed"

// dataFS —— 内置连接器的数据文件（manifest + spec + binding），go:embed 进二进制随产品发。
//
//go:embed data
var dataFS embed.FS
