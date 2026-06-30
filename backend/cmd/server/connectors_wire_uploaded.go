// connectors_wire_uploaded.go —— 拉起时把 DB 里 owner 自建（上传）连接器装回 Hub。拆出
// connectors_wire.go 守 max-lines；故障隔离的边界逻辑（坏连接器跳过不拖垮 boot）独立在此。

package main

import (
	"context"
	"log/slog"

	"github.com/atmaxmoj/standmeet/internal/connector"
	"github.com/atmaxmoj/standmeet/internal/postgres"
)

// registerUploadedConnectors —— 拉起重装 DB 里 owner 自建的连接器（跟内置同一路 assembleConnector）。
// **故障隔离**：永不 abort boot——装不起来的连接器只跳过 + 留痕，不拖垮其余、更不拖垮整实例。
func registerUploadedConnectors(
	ctx context.Context, hub *connector.Hub, repo *postgres.ConnectorRepo,
	deps *assembleDeps, log *slog.Logger,
) {
	uploaded, err := repo.ListUploaded(ctx)
	if err != nil {
		log.Error("load uploaded connectors", "err", err) // 跳过上传，内置照常
		return
	}
	for i := range uploaded {
		u := &uploaded[i]
		if _, isBuiltin := hub.Resolve(u.ConnectorID); isBuiltin {
			continue // 内置的「连接行」（owner 连了内置 smtp/gcal）：非上传定义，已装好
		}
		m := &connector.Manifest{
			ID: u.ConnectorID, Kind: u.Kind, Category: u.Category, Protocol: u.Protocol,
			AuthScheme: u.AuthScheme, Spec: u.Spec, Binding: u.Binding,
			ExposeAsAgentTools: u.ExposeAsAgentTools,
		}
		c, aerr := assembleConnector(m, deps)
		if aerr != nil {
			log.Error("skip unassemblable uploaded connector", "id", u.ConnectorID, "err", aerr)
			continue // 单个坏连接器跳过，不 abort
		}
		hub.Upsert(c)
	}
}
