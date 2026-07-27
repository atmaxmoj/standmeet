// retrieval_socket.go —— corpus.retrieval 内建插件的窄 host socket 接线（跟
// summarize_socket.go / booker_socket.go 同形）。外置的 retrieval 沙箱插件断网，经
// bind 进沙箱的 /run/standmeet/retrieval.sock 调 corpus_search / corpus_read /
// corpus_list host ops 跑真活（corpus wiki/output/writing listers 都在 host）。长活；
// 进程退出随之关。

package main

import (
	"context"
	"os"
	"time"

	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"

	"github.com/atmaxmoj/standmeet/internal/capabilities/capsocket"
)

func wireRetrievalSocket(ctx context.Context, d *runtimeDeps, deps *corpus.IndexDeps) {
	if mkErr := os.MkdirAll("/run/standmeet", socketDirMode); mkErr != nil {
		d.log.Error("retrieval socket dir", "err", mkErr)
		return
	}
	srv, err := capsocket.Listen(ctx, "/run/standmeet/retrieval.sock", d.log)
	if err != nil {
		d.log.Error("retrieval socket listen", "err", err)
		return
	}
	corpus.RegisterCorpusIndexSocket(srv, deps)
	go srv.Serve(ctx)
}

// wireSearchIndex —— boot 时建 Meili index(settings)+ 回填 sole owner 的 corpus。best-effort:
// Meili 挂/未配都不挡启动(D5:boot 时 Meili down 后端照常起),失败只记日志——写路径 + 健康恢复
// reconcile 会把 index 补齐。
func wireSearchIndex(ctx context.Context, d *runtimeDeps) {
	if d.searchClient == nil {
		return
	}
	if err := d.searchClient.EnsureIndex(ctx); err != nil {
		d.log.Error("meili ensure index", "err", err)
		return
	}
	soleOwner, err := owner.LoadSoleOwner(ctx, owner.PageDeps{Owners: d.ownerRepo})
	if err != nil {
		return // 未 claim / 查不到 → 无可回填
	}
	if d.corpusIndexer != nil {
		d.corpusIndexer.ReindexOwner(ctx, soleOwner.ID)
	}
}

// searchReconcileInterval —— 后台 reconcile tick。Meili 恢复后这个间隔内把 down 期间的写补上。
const searchReconcileInterval = 8 * time.Second

// wireSearchReconcile —— 后台循环:Meili 挂过(写失败置脏)后,恢复了就整批重建,补齐漏索引的写(D4)。
func wireSearchReconcile(ctx context.Context, d *runtimeDeps) {
	if d.corpusIndexer == nil {
		return
	}
	go d.reconcileLoop(ctx)
}

func (d *runtimeDeps) reconcileLoop(ctx context.Context) {
	ticker := time.NewTicker(searchReconcileInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			d.reconcileOnce(ctx)
		}
	}
}

func (d *runtimeDeps) reconcileOnce(ctx context.Context) {
	soleOwner, err := owner.LoadSoleOwner(ctx, owner.PageDeps{Owners: d.ownerRepo})
	if err != nil {
		return
	}
	d.corpusIndexer.Reconcile(ctx, soleOwner.ID)
}
