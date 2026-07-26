// service_deps.go —— Service 的注入依赖接口（composition root 满足）。从 service.go
// 拆出以保持后者 public-struct 数在预算内。

package connector

import (
	"context"
)

// ConnectionVerifier —— protocol 连接器 connect 时跑的连接测试（composition root 接 Slots）。
type ConnectionVerifier interface {
	VerifyConnector(ctx context.Context, connectorID, ownerID string) error
}

// Installer —— 校验（装配）一份上传 manifest + 注册进 live Hub，返回它声明的品类。composition
// root 接 AssembleOpenAPI + Slots.Register。
type Installer interface {
	Install(m *Manifest) (category string, err error)
}

// OwnerLookup —— connector 拼 oauth redirect URI 只需 owner 的 public_url。窄到只
// 读这一个 string，connector 因此不反依赖 owner 模块；composition root 注入实现
// （owner.Repo 结构上满足）。
type OwnerLookup interface {
	PublicURL(ctx context.Context, ownerID string) (string, error)
}
