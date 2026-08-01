// wire_owner_mcp.go —— build the ownercore plugin's Deps from runtimeDeps. #135: every owner-MCP
// capability moved off core mcphandle into the ownercore in-process plugin; this assembles its
// (fat, but that's the plugin's whole surface) dependency bundle. Called from buildPluginRegistry.

package main

import (
	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
	"github.com/atmaxmoj/standmeet/internal/owner/ownercore"
)

func buildOwnerCoreDeps(d *runtimeDeps) *ownercore.Deps {
	corpusDeps := corpusDepsOf(d)
	writingsTxDeps := corpus.WritingsTxDeps{
		Writings:    d.writingRepo,
		WritingRefs: d.writingRefRepo,
		Assets:      corpus.AssetsDeps{Repo: d.assetRepo, Storage: d.storageClient},
	}
	return &ownercore.Deps{
		SEO:        d.seoRepo,
		Corpus:     &corpusDeps,
		Writings:   &corpus.WritingsDeps{Writings: d.writingRepo},
		WritingsTx: &writingsTxDeps,
		Connectors: &ownercore.ConnectorsOwnerDeps{
			Svc:  connSvcAdapter{svc: newConnectorService(d)},
			Mail: d.connectorSlots.Mail(), MailKind: d.connectorSlots.MailKind,
		},
		Log: d.log,
	}
}
