// service.go —— 连接器编排服务的构造。admin 面板和 connectors 资源共用同一个。
//
// 它曾经放在组装根的"适配器"那一堆里,因为 ownercore 不能 import 连接器服务,于是每个方法
// 都要把参数和结果在两套等价类型之间搬一遍。connectors 归了连接器轴自己声明之后,那层翻译
// 整个消失 —— 声明和实现在同一侧,没有第二套类型。这个构造也就回到了轴自己这儿。

package axisconn

import (
	"github.com/atmaxmoj/standmeet/cmd/server/deps"
	"github.com/atmaxmoj/standmeet/internal/connector"
)

// NewService —— 建连接器编排服务。
func NewService(d *deps.Runtime) *connector.Service {
	return connector.New(&connector.Deps{
		Repo: d.ConnectorRepo, Owners: d.OwnerRepo, Redis: d.RDB,
		HTTP: connectorEgressClient(), Verifier: d.ConnectorSlots,
		Installer: uploadedInstaller{
			slots: d.ConnectorSlots, deps: newAssembleDeps(d.ConnectorRepo),
		},
		Manifests: loadBuiltinConnectorManifests(d),
	})
}
