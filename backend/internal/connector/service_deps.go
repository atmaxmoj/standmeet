// service_deps.go —— Service 的注入依赖接口（composition root 满足）。从 service.go
// 拆出以保持后者 public-struct 数在预算内。

package connector

import (
	"context"

	"github.com/atmaxmoj/standmeet/internal/owner"
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

// OwnerLookup —— connector 拼 oauth redirect URI 只需 owner 的 public_url。用窄接口
// 而不是 *postgres.OwnerRepo，避免 connector 反依赖 postgres（repo 层）——composition
// root 注入实际实现（postgres.OwnerRepo 结构上满足）。
type OwnerLookup interface {
	GetByID(ctx context.Context, ownerID string) (owner.Owner, error)
}
