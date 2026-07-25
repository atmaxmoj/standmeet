// mail_sender_socket.go —— mail.send 内建插件的窄 host socket。插件断网,经
// /run/standmeet/mail-sender.sock 调 "send" host op 跑真 MailContract.Send(active mail 连接器)。
// (booker 已迁到固定词表 reach-back 网关,见 booker_gateway.go;mail-sender 尚未迁,仍走此路。)

package main

import (
	"context"
	"os"

	"github.com/atmaxmoj/standmeet/internal/capsocket"
	"github.com/atmaxmoj/standmeet/internal/usecases"
)

func wireMailSenderSocket(ctx context.Context, d *runtimeDeps) {
	if mkErr := os.MkdirAll("/run/standmeet", socketDirMode); mkErr != nil {
		d.log.Error("mail-sender socket dir", "err", mkErr)
		return
	}
	srv, err := capsocket.Listen(ctx, "/run/standmeet/mail-sender.sock", d.log)
	if err != nil {
		d.log.Error("mail-sender socket listen", "err", err)
		return
	}
	usecases.RegisterMailSenderSocket(srv, &usecases.MailSenderDeps{Proxy: d.connectorSlots.Mail()})
	go srv.Serve(ctx)
}
