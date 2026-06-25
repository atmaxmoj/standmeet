// transient.go —— 把外部 HTTP 失败标成可判定的 error 类，供 connector 重试层
// (internal/retry 的 Retryable 谓词) 分类用。两档：
//
//   - ErrTransport —— 发送前的传输/连接失败（连接拒、超时、conn reset）。请求很可能
//     没到对端 → 重试安全，**写操作也能重**（配幂等键防重发副作用）。
//   - ErrServerBusy —— 对端已回 429/5xx。请求已送达、副作用未知 → **读可重、写不可
//     盲重**（写非幂等，可能已生效，盲重会双写）。
//
// 谓词：Transport() 只认前者；Transient() 认两者。connector 只读这两个谓词，不反向
// import retry —— 分类是 gcal 对外部 HTTP 语义的认定。invalid_grant / 4xx / 解码错
// 两者都不沾 → 不可重试（直接降级）。

package gcal

import (
	"errors"
	"fmt"
	"net/http"
)

// ErrTransport —— 发送前传输/连接失败（pre-send）。读写都可重（写需幂等键）。
var ErrTransport = errors.New("gcal: transport")

// ErrServerBusy —— 对端 429/5xx。读可重；写不可盲重（可能已生效）。
var ErrServerBusy = errors.New("gcal: server busy")

// Transport —— err 是否发送前传输错（写操作的 Retryable 谓词：只重 pre-send）。
func Transport(err error) bool { return errors.Is(err, ErrTransport) }

// Transient —— err 是否瞬时（读操作的 Retryable 谓词：传输错 + 429/5xx）。
func Transient(err error) bool { return Transport(err) || errors.Is(err, ErrServerBusy) }

// transientStatus —— 哪些 HTTP 状态算瞬时：429（限流）+ 500/502/503/504（服务端）。
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

// transportErr —— 包一次传输层失败（http.Do 返 err）为 pre-send transport（可重）。
func transportErr(what string, err error) error {
	return fmt.Errorf("gcal: %s: %w: %w", what, err, ErrTransport)
}
