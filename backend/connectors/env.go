// env.go —— 内置连接器 spec/binding 里的 `${VAR:-default}` 占位在 Load 时按环境展开。内置
// 连接器（如 gcal）的端点 prod 默认指向真服务；e2e 把 GOOGLE_OAUTH_AUTH_URL / _TOKEN_URL /
// GOOGLE_CALENDAR_BASE_URL 指向 mock-stack。占位语法只支持 `${NAME}` 与 `${NAME:-default}`。

package connectors

import (
	"os"
	"regexp"
)

// envRE —— 匹配 ${NAME} 或 ${NAME:-default}。
var envRE = regexp.MustCompile(`\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}`)

// expandEnv —— 把 raw 里的 ${VAR:-default} 占位按环境展开（env 有值用 env，否则用 default）。
func expandEnv(raw []byte) []byte {
	return envRE.ReplaceAllFunc(raw, func(match []byte) []byte {
		sub := envRE.FindSubmatch(match)
		if v := os.Getenv(string(sub[1])); v != "" {
			return []byte(v)
		}
		return sub[2] // 默认值（无 :- 时为 nil → 空）
	})
}
