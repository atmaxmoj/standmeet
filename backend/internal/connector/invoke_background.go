// invoke_background.go —— 后台(fire-and-forget)连接器调用 + 瞬时错重试。
//
// 为什么需要:有些调用的**结果不该挡住调用方**。约成后给 owner 发的通知信就是典型 ——
// 预约已经落库、日历事件已经建好,访客正盯着卡片等返回;为一封通知信把 tool 调用挂住
// (还要等重试退避)是本末倒置。
//
// 为什么必须在 host 而不是能力自己起 goroutine:沙箱能力的进程生命周期**只有这一轮**,
// tool 调用一返回它就可能被回收 —— 起在里面的重试 goroutine 会跟着进程一起消失,第一次
// 退避都熬不过。所以"过一轮之后还要继续做的事"只能由 host 持有。
//
// 重试基座按 arch 只允许 connector 层用,所以退避策略留在这儿(复用 notifyPolicy),
// 而不是散进 routes/cmd。

package connector

import (
	"context"
	"encoding/json"
	"log/slog"
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/retry"
)

// backgroundBudget —— 后台调用的总时限。比 notifyPolicy 的 MaxTotal 略宽,留出最后一次尝试
// 跑完的余量;超时就放弃(不无限挂着占资源)。
const backgroundBudget = 3 * time.Minute

// SetLogger —— 后台调用失败时的去处。没设 → 静默(只有测试装配会这样)。
// 日志器随 Slots 一次性注入,不逐次调用传:那样参数表会撑爆,而且 routes 那层薄壳按 arch
// 不允许 import connector,没法共享一个入参结构体。
func (s *Slots) SetLogger(log *slog.Logger) { s.log = log }

// InvokeBackground —— 立刻返回,调用在后台跑,瞬时传输错按 notifyPolicy 退避重试。
//
// ctx 只用来取消"排队"本身是没意义的:调用方(沙箱)马上就走,它的 ctx 随即取消。所以这里
// 刻意用 context.WithoutCancel 切断父取消,只保留自己的预算 —— 否则后台任务会在出生的
// 瞬间就被取消掉(而且是静默的)。
func (s *Slots) InvokeBackground(
	ctx context.Context, ownerID, category, verb string, args json.RawMessage,
) {
	detached, cancel := context.WithTimeout(context.WithoutCancel(ctx), backgroundBudget)
	go func() {
		defer cancel()
		err := retry.Do(detached, notifyPolicy(), func() error {
			_, ierr := s.Invoke(detached, ownerID, category, verb, args)
			return ierr
		})
		if err != nil && s.log != nil {
			// 后台失败没人在等它 —— 不吼出来就等于没发生过。
			s.log.Error("connector background invoke failed",
				"category", category, "verb", verb, "owner", ownerID, "err", err)
		}
	}()
}
