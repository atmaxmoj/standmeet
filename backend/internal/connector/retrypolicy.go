// retrypolicy.go —— connector 出站重试策略（决策点 D-6/D-7）。架在 internal/retry 通用底座
// 之上——底座只管「按退避重试、封顶、可打断」，本处只「配」不「改」。#155 后日历连接器的
// 同步读写重试随 gcal-specific proxy 一起退场；只剩 owner-notify 异步发信的长预算后台重试。

package connector

import (
	"time"

	"github.com/atmaxmoj/standmeet/internal/retry"
)

const (
	notifyMaxAttempts = 10
	notifyBaseDelay   = 2 * time.Second
	notifyMaxInterval = 60 * time.Second
	notifyMaxTotal    = 2 * time.Minute
)

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
