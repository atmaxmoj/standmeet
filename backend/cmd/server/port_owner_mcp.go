// port_owner_mcp.go —— 组装期的小适配器。
//
// 连接器编排的那一整套 DTO 翻译曾经在这儿:ownercore 不能 import connectorsvc,于是每个
// 方法都要把参数和结果在两套等价类型之间搬一遍。connectors 归了连接器轴自己声明之后
// (axis_conn_ops.go),那层翻译整个消失 —— 声明和实现在同一侧,没有第二套类型。

package main

import (
	"github.com/atmaxmoj/standmeet/internal/connector"
)

// newConnectorService —— build the connector orchestration service. Shared by the
// admin panel (connectorsAdminDeps) and the connectors resource.
func newConnectorService(d *runtimeDeps) *connector.Service {
	return connector.New(&connector.Deps{
		Repo: d.connectorRepo, Owners: d.ownerRepo, Redis: d.rdb,
		HTTP: connectorEgressClient(), Verifier: d.connectorSlots,
		Installer: uploadedInstaller{
			slots: d.connectorSlots, deps: newAssembleDeps(d.connectorRepo),
		},
		Manifests: loadBuiltinConnectorManifests(d),
	})
}
