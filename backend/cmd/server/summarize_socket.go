// summarize_socket.go —— summarize 内建插件的窄 host socket 接线。
//
// summarize 外置成 sandbox_stdio 插件后跑在 bwrap 里、断网，够不到后端的
// transcript/LLM/落库。给它 bind 进沙箱一个窄 unix socket（/run/standmeet/
// summarize.sock）：host 在这头跑 report pipeline，插件经 socket 只能调
// summarize 这一个 op。socket 在 --unshare-net 下照样可达（unix socket 是
// 文件系统，不走网络 namespace）。长活；进程退出随之关。

package main

import (
	"context"
	"os"

	"github.com/atmaxmoj/standmeet/internal/capsocket"
	"github.com/atmaxmoj/standmeet/internal/usecases"
)

const socketDirMode = 0o700

func wireSummarizeSocket(
	ctx context.Context, d *runtimeDeps, skills *usecases.VisitorSkillsDeps,
) {
	if mkErr := os.MkdirAll("/run/standmeet", socketDirMode); mkErr != nil {
		d.log.Error("summarize socket dir", "err", mkErr)
		return
	}
	srv, err := capsocket.Listen(ctx, "/run/standmeet/summarize.sock", d.log)
	if err != nil {
		d.log.Error("summarize socket listen", "err", err)
		return
	}
	usecases.RegisterSummarizeSocket(srv, &usecases.SummarizeDeps{
		Chats: d.chatRepo, Reports: skills.Reports, Resolver: skills.Resolver,
	})
	go srv.Serve(ctx)
}
