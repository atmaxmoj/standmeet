// retrieval_socket.go —— corpus.retrieval 内建插件的窄 host socket 接线（跟
// summarize_socket.go / booker_socket.go 同形）。外置的 retrieval 沙箱插件断网，经
// bind 进沙箱的 /run/standmeet/retrieval.sock 调 corpus_search / corpus_read /
// corpus_list host ops 跑真活（corpus wiki/output/writing listers 都在 host）。长活；
// 进程退出随之关。

package main

import (
	"context"
	"os"

	"github.com/atmaxmoj/standmeet/internal/capsocket"
	"github.com/atmaxmoj/standmeet/internal/usecases"
)

func wireRetrievalSocket(ctx context.Context, d *runtimeDeps, deps *usecases.RetrievalDeps) {
	if mkErr := os.MkdirAll("/run/standmeet", socketDirMode); mkErr != nil {
		d.log.Error("retrieval socket dir", "err", mkErr)
		return
	}
	srv, err := capsocket.Listen(ctx, "/run/standmeet/retrieval.sock", d.log)
	if err != nil {
		d.log.Error("retrieval socket listen", "err", err)
		return
	}
	usecases.RegisterRetrievalSocket(srv, deps)
	go srv.Serve(ctx)
}
