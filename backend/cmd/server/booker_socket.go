// booker_socket.go —— calendar.book 内建插件的窄 host socket 接线（跟
// summarize_socket.go 同形）。外置的 booker 沙箱插件断网，经 bind 进沙箱的
// /run/standmeet/booker.sock 调 book / list_slots host ops 跑真活（日历 connector /
// booking store / 约成通知都在 host）。长活；进程退出随之关。

package main

import (
	"context"
	"log/slog"
	"os"

	"github.com/atmaxmoj/standmeet/internal/capsocket"
	"github.com/atmaxmoj/standmeet/internal/connector"
	"github.com/atmaxmoj/standmeet/internal/usecases"
)

// newBookerDeps —— booker host ops 的窄依赖（book/list_slots 用 Proxy/Store/Owners/
// Notify；send_confirmation 用 Confirm，复用确认信 deps，凭据在 MailProxy 内）。
// 同 NewBookerGate / NewBookerStateHook / RegisterBookerSocket 共一份。
func newBookerDeps(d *runtimeDeps, skills *usecases.VisitorSkillsDeps) *usecases.BookerDeps {
	return &usecases.BookerDeps{
		Proxy: skills.Proxy, Store: skills.Calendar,
		Owners: skills.Owners, Notify: skills.Notify,
		Confirm: usecases.BookingConfirmDeps{
			Calendar: d.calendarRepo, Mail: d.mailRepo, Owners: d.ownerRepo,
			Proxy: d.connectorSlots.Mail(),
		},
		Cancel: usecases.VisitorCancelDeps{
			Proxy: d.connectorSlots.Calendar(),
			Store: calendarStoreAdapter{repo: d.calendarRepo},
		},
		NotifyOwnerAsync: ownerNotifyAsync(retryingNotify(skills.Notify), d.log),
	}
}

// retryingNotify —— owner-notify 的发信换成 connector 的 RetryingMailProxy（瞬时传输错
// 后台重试在那层；retry 基座只许 connector 用）。确认信不换 → 同步单发不重。
func retryingNotify(notify usecases.OwnerNotifyDeps) usecases.OwnerNotifyDeps {
	notify.Proxy = connector.NewRetryingMailProxy(notify.Proxy)
	return notify
}

// ownerNotifyAsync —— 把 owner 通知做成异步 + 不堵 booking（D-6 R6）：约成立即返回，
// 发信（含 RetryingMailProxy 的后台重试）在 goroutine 里跑，彻底失败只 warn。WithoutCancel：
// 脱离请求取消（请求返回后 ctx 即取消，后台重试得自己活着）但保留 parent values。
func ownerNotifyAsync(
	notify usecases.OwnerNotifyDeps, log *slog.Logger,
) func(context.Context, *usecases.NotifyOwnerOfBookingInput) {
	return func(ctx context.Context, in *usecases.NotifyOwnerOfBookingInput) {
		bg := context.WithoutCancel(ctx)
		go func() {
			if err := usecases.NotifyOwnerOfBooking(bg, notify, in); err != nil {
				log.Warn("owner booking notify gave up after retries",
					"owner_id", in.OwnerID, "err", err)
			}
		}()
	}
}

func wireBookerSocket(ctx context.Context, d *runtimeDeps, deps *usecases.BookerDeps) {
	if mkErr := os.MkdirAll("/run/standmeet", socketDirMode); mkErr != nil {
		d.log.Error("booker socket dir", "err", mkErr)
		return
	}
	srv, err := capsocket.Listen(ctx, "/run/standmeet/booker.sock", d.log)
	if err != nil {
		d.log.Error("booker socket listen", "err", err)
		return
	}
	usecases.RegisterBookerSocket(srv, deps)
	go srv.Serve(ctx)
}
