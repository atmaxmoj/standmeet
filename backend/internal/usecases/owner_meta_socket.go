// owner_meta_socket.go —— owner.meta host op：断网沙箱 cap 经 socket 读**白名单** owner 字段
// (时区/名字/邮箱)。按业务分类:它跟 owner 数据一起,不进机制 bucket。非白名单字段一律拒
// (不泄露任意 owner 数据)。cmd 按需要 owner 元数据的 cap 挂这个。

package usecases

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/capsocket"
	"github.com/atmaxmoj/standmeet/internal/domain"
)

// OwnerMetaLookup —— 取 owner 记录(owner.meta 只读它的白名单字段)。
type OwnerMetaLookup interface {
	GetByID(ctx context.Context, ownerID string) (domain.Owner, error)
}

// RegisterOwnerMetaOp —— 把 "owner.meta" 挂到 srv:{owner_id,field} → 白名单字段值,否则拒。
func RegisterOwnerMetaOp(srv *capsocket.Server, owners OwnerMetaLookup) {
	srv.Handle("owner.meta", func(
		ctx context.Context, raw json.RawMessage,
	) (json.RawMessage, error) {
		return runOwnerMeta(ctx, owners, raw)
	})
}

func runOwnerMeta(
	ctx context.Context, owners OwnerMetaLookup, raw json.RawMessage,
) (json.RawMessage, error) {
	var req struct {
		OwnerID string `json:"owner_id"`
		Field   string `json:"field"`
	}
	if err := json.Unmarshal(raw, &req); err != nil {
		return nil, fmt.Errorf("owner.meta: decode: %w", err)
	}
	owner, err := owners.GetByID(ctx, req.OwnerID)
	if err != nil {
		return nil, fmt.Errorf("owner.meta: %w", err)
	}
	served := map[string]string{
		"timezone":  owner.ProfileTimezone,
		"full_name": owner.FullName,
		"email":     owner.Email,
	}
	val, ok := served[req.Field]
	if !ok {
		return nil, fmt.Errorf("owner.meta: field %q not allowed", req.Field)
	}
	out, merr := json.Marshal(map[string]string{"value": val})
	if merr != nil {
		return nil, fmt.Errorf("owner.meta: marshal: %w", merr)
	}
	return out, nil
}
