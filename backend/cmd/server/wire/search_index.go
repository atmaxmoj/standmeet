// search_index.go —— corpus 词法检索(Meili)的启动接线:建 index、回填、后台 reconcile。
//
// 它原来搭在 retrieval_socket.go 里(那个文件因为 retrieval 插件才存在);入站收口把 socket
// 接线收走以后,这几件事跟"谁在读语料"没关系,自己占一个地址。

package wire

import (
	"context"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"

	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
)

// SearchIndex —— boot 时建 Meili index(settings)+ 回填 sole owner 的 corpus。best-effort:
// Meili 挂/未配都不挡启动(D5:boot 时 Meili down 后端照常起),失败只记日志——写路径 + 健康恢复
// reconcile 会把 index 补齐。
func SearchIndex(ctx context.Context, d *deps.Runtime) {
	if d.SearchClient == nil {
		return
	}
	if err := d.SearchClient.EnsureIndex(ctx); err != nil {
		d.Log.Error("meili ensure index", "err", err)
		return
	}
	soleOwner, err := owner.LoadSoleOwner(ctx, owner.PageDeps{Owners: d.OwnerRepo})
	if err != nil {
		return // 未 claim / 查不到 → 无可回填
	}
	if d.CorpusIndexer != nil {
		d.CorpusIndexer.ReindexOwner(ctx, soleOwner.ID)
	}
}

// reconcile 的那个后台循环不在这儿了:它是 corpus 域自己的周期任务声明
// (corpus.IndexPeriodicJobs),由 wirePeriodicJobs 汇总起调度 —— 顺带第一次进了 Monitor
// 的后台任务面板(手写的那版从来没登记过,一直在跑却看不见)。
