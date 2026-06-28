// retrypolicy.go —— connector 出站重试策略（决策点 D-6/D-7）。架在 internal/retry 通用底座
// 之上——底座只管「按退避重试、封顶、可打断」，本处只「配」不「改」。owner-notify 异步发信长
// 预算后台重试；openapi 日历同步读/写短预算重试瞬时错（#155 归一到 StatusError.Transient）。

package connector

import (
	"errors"
	"io"
	"net"
	"time"

	"github.com/atmaxmoj/standmeet/internal/connector/openapi"
	"github.com/atmaxmoj/standmeet/internal/retry"
)

const (
	notifyMaxAttempts = 10
	notifyBaseDelay   = 2 * time.Second
	notifyMaxInterval = 60 * time.Second
	notifyMaxTotal    = 2 * time.Minute
)

const (
	calRetryMaxAttempts = 4
	calRetryBaseDelay   = 50 * time.Millisecond
	calRetryMaxInterval = 500 * time.Millisecond
	calRetryMaxTotal    = 4 * time.Second
)

// calendarRetryPolicy —— openapi 日历出站读/写重试（D-6/D-7）：只重瞬时错（429/5xx 的
// StatusError + 网络抖动），短预算（同步路径，访客在等）。永久错（4xx/invalid_grant）不重。
func calendarRetryPolicy() retry.Policy {
	return retry.Policy{
		Retryable:   openapiTransient,
		MaxAttempts: calRetryMaxAttempts,
		BaseDelay:   calRetryBaseDelay,
		MaxInterval: calRetryMaxInterval,
		MaxTotal:    calRetryMaxTotal,
	}
}

// openapiTransient —— 瞬时错判定：StatusError.Transient（429/5xx）或网络层抖动（dial/超时/EOF）。
func openapiTransient(err error) bool {
	if err == nil {
		return false
	}
	var se *openapi.StatusError
	if errors.As(err, &se) {
		return se.Transient
	}
	var ne net.Error
	if errors.As(err, &ne) {
		return true
	}
	return errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF)
}

// notifyPolicy —— owner-notify 异步发信（D-6 R6）：长预算后台重试，只重瞬时传输错
// （连接被断/拒/超时；发信未达对端，重发安全），永久错（未配置等）不重。RetryingMailProxy
// 用；确认信走同步单发不重。
func notifyPolicy() retry.Policy {
	return retry.Policy{
		Retryable:   mailTransient,
		MaxAttempts: notifyMaxAttempts,
		BaseDelay:   notifyBaseDelay,
		MaxInterval: notifyMaxInterval,
		MaxTotal:    notifyMaxTotal,
	}
}
