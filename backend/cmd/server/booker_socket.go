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
