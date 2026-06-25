// retrypolicy.go —— connector 代调外部（第三方易抖）的 per-op 重试策略（决策点
// D-6：每个操作按自身业务语义声明自己的模式 + 预算；D-7：sync 默认 3 次、退避
// 1s/2s/4s、总时长 ~10s 三硬封顶）。策略架在 internal/retry 通用底座之上——底座
// 只管「按退避重试、封顶、可打断」，本处只「配」不「改」。
//
// Retryable = gcal.Transient：网络/传输错 + 429/5xx 才重；invalid_grant / 4xx /
// 解码错不重（直接降级）——token refresh 撞 invalid_grant 即一次到位友好降级，
// 不烧重试预算。

package connector

import (
	"context"
	"crypto/rand"
	"encoding/base32"
	"fmt"
	"strings"
	"time"

	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/gcal"
	"github.com/atmaxmoj/standmeet/internal/retry"
)

// calendarRetry —— 按给定 policy 跑一次 connector 调用并归一错误：瞬时错（重试耗尽
// 或不可重的 5xx 写）→ domain.ErrCalendarUnavailable（visitor-facing 层映成「稍后
// 再试」友好降级，不泄漏底层 5xx / stack）；其余原样包。把映射从各调用点抽出，压
// cyclop。读传 readPolicy（传输错 + 5xx 都重）；写传 writePolicy（只重 pre-send
// 传输错，5xx 不盲重——非幂等写可能已生效）。
func calendarRetry(ctx context.Context, policy retry.Policy, fn func() error) error {
	err := retry.Do(ctx, policy, fn)
	if err == nil {
		return nil
	}
	if gcal.Transient(err) {
		return domain.ErrCalendarUnavailable
	}
	return fmt.Errorf("calendar: %w", err)
}

// idempotencyKeyBytes —— 16 字节随机 → base32hex（128 位，碰撞可忽略）。
const idempotencyKeyBytes = 16

// idempotencyKey —— 生成一个 Google event-id 合法的幂等键（base32hex：a-v0-9，
// 小写）。InsertEvent 重试前生成一次、跨重试复用，保证瞬时错重试不双订。
func idempotencyKey() (string, error) {
	b := make([]byte, idempotencyKeyBytes)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("idempotency key: %w", err)
	}
	return strings.ToLower(base32.HexEncoding.WithPadding(base32.NoPadding).EncodeToString(b)), nil
}

const (
	syncMaxAttempts = 3
	syncBaseDelay   = time.Second
	syncMaxInterval = 4 * time.Second
	syncMaxTotal    = 10 * time.Second
)

// readPolicy —— 读类（freeBusy / list_slots）：sync 短预算，传输错 + 5xx 都重（读
// 幂等，重试无副作用），永久错快速降级。
func readPolicy() retry.Policy {
	return retry.Policy{
		Retryable:   gcal.Transient,
		MaxAttempts: syncMaxAttempts,
		BaseDelay:   syncBaseDelay,
		MaxInterval: syncMaxInterval,
		MaxTotal:    syncMaxTotal,
	}
}

// writePolicy —— 写类（events.insert）：**只重 pre-send 传输错**（连接失败请求多半
// 没到对端，配幂等键重发安全）；**5xx 不重**（非幂等写可能已生效，盲重会双订）→
// 直接友好降级。配 InsertEvent 的幂等键一起，保证「连接断重发恰好一单」。
func writePolicy() retry.Policy {
	return retry.Policy{
		Retryable:   gcal.Transport,
		MaxAttempts: syncMaxAttempts,
		BaseDelay:   syncBaseDelay,
		MaxInterval: syncMaxInterval,
		MaxTotal:    syncMaxTotal,
	}
}
