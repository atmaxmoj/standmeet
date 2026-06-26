// booker_socket.go —— calendar.book 内建插件的窄 host socket 接线（跟
// summarize_socket.go 同形）。外置的 booker 沙箱插件断网，经 bind 进沙箱的
// /run/standmeet/booker.sock 调 book / list_slots host ops 跑真活（日历 connector /
// booking store / 约成通知都在 host）。长活；进程退出随之关。

package main

import (
	"context"
	"os"

	"github.com/atmaxmoj/standmeet/internal/capsocket"
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
			Proxy: mailProxy(d),
		},
		Cancel: usecases.VisitorCancelDeps{
			Proxy: calendarProxy(d),
			Store: calendarStoreAdapter{repo: d.calendarRepo},
		},
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
