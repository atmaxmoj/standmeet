// uc_public_url_validate.go —— owner public_url 的校验/规范化(claim + 设置公用)。

package owner

import (
	"errors"
	"strings"
)

// ErrPublicURLInvalid —— public_url 不是 http(s):// 开头的 URL。
var ErrPublicURLInvalid = errors.New("public_url must be a full URL with scheme")

const (
	httpPrefix  = "http://"
	httpsPrefix = "https://"
)

// ValidPublicURL —— public_url 是否 http(s):// 开头的完整 URL。
func ValidPublicURL(s string) bool {
	return len(s) > len(httpsPrefix) &&
		(strings.HasPrefix(s, httpPrefix) || strings.HasPrefix(s, httpsPrefix))
}

// NormalizePublicURL —— 去末尾斜杠。dev "http://localhost:38127/" 跟
// "http://localhost:38127" 写进 DB 后保持一致；QR builder 直接拼 "/?code=" 即可。
func NormalizePublicURL(s string) string {
	for s != "" && s[len(s)-1] == '/' {
		s = s[:len(s)-1]
	}
	return s
}
