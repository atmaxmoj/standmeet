// Package apierr 提供 domain / usecase sentinel error → HTTP envelope 的翻译。
//
// 为什么单独成包：admin / public 等 routes 包 handlers 受 cyclo ≤ 3 限制，
// switch/case 翻译 5 个 error 就超了。把翻译挪到 routes/ 之外的 apierr 包
// 用 table-driven 的 Classify(err, cases)，调用点 cyclo 始终 ≤ 2。
package apierr

import "errors"

// Envelope 是统一错误响应的内容。字段顺序按 fieldalignment。
type Envelope struct {
	Code    string
	Message string
	Status  int
}

// Case 把"匹配哪个 sentinel error → 翻成哪个 envelope"一一对应。
// 多个 case 按顺序匹配；调用方控制 case 顺序（first-match-wins）。
type Case struct {
	Match    error
	Envelope Envelope
}

// fallback —— 没匹配任何 case 时的 envelope。caller 在 handler 里看到
// status >= 500 时再 log，避免 noise。
var fallback = Envelope{
	Status:  500,
	Code:    "server_error",
	Message: "internal error",
}

// Classify 用 errors.Is 顺序匹配 cases；都不匹配返回 500 fallback。
// 函数 cyclo = 2（for + if），调用方 cyclo = 1。
func Classify(err error, cases []Case) Envelope {
	for _, c := range cases {
		if errors.Is(err, c.Match) {
			return c.Envelope
		}
	}
	return fallback
}
