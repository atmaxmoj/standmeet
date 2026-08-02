// wire_search_index.go —— corpus 词法检索(Meili)的启动接线:建 index、回填、后台 reconcile。
//
// 它原来搭在 retrieval_socket.go 里(那个文件因为 retrieval 插件才存在);入站收口把 socket
// 接线收走以后,这几件事跟"谁在读语料"没关系,自己占一个地址。

package main

import (
	"context"
	"time"

	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
)

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
