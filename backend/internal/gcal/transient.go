// transient.go —— 把「可重试的瞬时失败」标成可判定的 error 类，供 connector 重试层
// (internal/retry 的 Retryable 谓词) 分类用。瞬时 = 网络/传输错 + 429/5xx；永久 =
// 4xx / invalid_grant / 解码错 等（不重，直接降级）。connector 只读 Transient()，不
// 反过来 import retry —— 分类是 gcal 自己对外部 HTTP 语义的认定。

package gcal

import (
	"errors"
	"fmt"
	"net/http"
)

// ErrTransient —— sentinel：被它包裹的 error 代表一次「瞬时」失败（重试可能成功）。
// 传输错与 429/5xx 状态错包它；invalid_grant / 4xx / 解码错不包 → 不可重试。
var ErrTransient = errors.New("gcal: transient")

// Transient —— err 是否瞬时（connector 重试策略的 Retryable 谓词）。
func Transient(err error) bool { return errors.Is(err, ErrTransient) }

// transientStatus —— 哪些 HTTP 状态算瞬时：429（限流）+ 502/503/504（网关/不可用）
// + 500（服务端错）。其余 4xx 永久。
func transientStatus(code int) bool {
	switch code {
	case http.StatusTooManyRequests,
		http.StatusInternalServerError,
		http.StatusBadGateway,
		http.StatusServiceUnavailable,
		http.StatusGatewayTimeout:
		return true
	default:
		return false
	}
}

// transportErr —— 包一次传输层失败（http.Do 返 err：连接拒/超时/conn reset）为瞬时。
func transportErr(what string, err error) error {
	return fmt.Errorf("gcal: %s: %w: %w", what, err, ErrTransient)
}
