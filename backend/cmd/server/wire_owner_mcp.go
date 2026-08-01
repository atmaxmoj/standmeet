// wire_owner_mcp.go —— ownercore 插件的 deps。这个包正在解散,只剩 writings 的写
// (multipart 那笔债),所以这里也只剩 writings 那两份依赖。债还清、包删掉,这个文件跟着消失。

package main

import (
	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
	"github.com/atmaxmoj/standmeet/internal/owner/ownercore"
)

func buildOwnerCoreDeps(d *runtimeDeps) *ownercore.Deps {
	return &ownercore.Deps{
		Writings: &corpus.WritingsDeps{Writings: d.writingRepo},
		WritingsTx: &corpus.WritingsTxDeps{
			Writings:    d.writingRepo,
			WritingRefs: d.writingRefRepo,
			Assets:      corpus.AssetsDeps{Repo: d.assetRepo, Storage: d.storageClient},
		},
		Log: d.log,
	}
}
