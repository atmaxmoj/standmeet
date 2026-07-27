// uc_access_requests_ports.go —— 访客留言绑定到 sole owner 只需 ownerID 的窄口。

package access

import "context"

// SoleOwnerLookup —— 取单-owner 实例的 owner id(绑定 access request 用)。
// composition root 用 owner.Repo(FirstHandle→GetByHandle→ID)适配,access 不反依赖 owner。
type SoleOwnerLookup interface {
	SoleOwnerID(ctx context.Context) (string, error)
}
