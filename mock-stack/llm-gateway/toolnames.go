// toolnames.go —— 替身也按真 provider 的规矩收工具名。
//
// 真世界里 Anthropic / OpenAI 都把 `tools[].name` 限制在 `^[a-zA-Z0-9_-]+$`，
// 而且**整个数组一起拒** —— 一条名字不合法，这一轮所有工具都不进模型。
// 这台替身以前什么名字都收，于是「产品发出去的名字合不合法」这件事，
// 整套 e2e 从来没有量过一次（[[stand-in-is-politer-than-reality]]）。
//
// 400 的措辞逐字照抄真 provider 那句，好让红态跟真环境的日志对得上。
package main

import (
	"fmt"
	"net/http"
	"regexp"
)

var toolNameOK = regexp.MustCompile(`^[a-zA-Z0-9_-]+$`)

// rejectBadToolName —— 有不合法的工具名 → 写出 400 并返回 true（这一轮到此为止）。
func rejectBadToolName(w http.ResponseWriter, req *MessagesReq) bool {
	for i := range req.Tools {
		if toolNameOK.MatchString(req.Tools[i].Name) {
			continue
		}
		http.Error(w, fmt.Sprintf(
			`{"error":{"type":"invalid_request_error","message":`+
				`"Invalid 'tools[%d].function.name': string does not match pattern. `+
				`Expected a string that matches the pattern '^[a-zA-Z0-9_-]+$'."}}`, i),
			http.StatusBadRequest)
		return true
	}
	return false
}
