// host.go —— 本域开给**沙箱能力**的那件事(入站方向)。
//
// 只有一件:读 owner 的**白名单**字段。非白名单一律拒 —— 沙箱能问"owner 在哪个时区",
// 不能顺手把 owner 的整条记录捞走。白名单写死在这儿,加字段是改这一行的事,评审看得见。

package ops

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/infra/hostop"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
)

// MetaLookup —— 取 owner 记录(只读白名单字段)。
type MetaLookup interface {
	GetByID(ctx context.Context, ownerID string) (entity.Owner, error)
}

// HostOps —— owner.meta。
func HostOps(owners MetaLookup) []hostop.Op {
	return []hostop.Op{{
		Name: "owner.meta",
		Description: "Read one whitelisted owner field (timezone / full_name / email). " +
			"Anything else is refused — this is not a way to read the owner row.",
		Invoke: readOwnerMeta(owners),
	}}
}

func readOwnerMeta(owners MetaLookup) hostop.Invoke {
	return func(ctx context.Context, raw json.RawMessage) (json.RawMessage, error) {
		var req struct {
			OwnerID string `json:"owner_id"`
			Field   string `json:"field"`
		}
		if err := json.Unmarshal(raw, &req); err != nil {
			return nil, fmt.Errorf("owner.meta: decode: %w", err)
		}
		row, err := owners.GetByID(ctx, req.OwnerID)
		if err != nil {
			return nil, fmt.Errorf("owner.meta: %w", err)
		}
		return whitelistedField(&row, req.Field)
	}
}

// whitelistedField —— 白名单在这儿,只有这一份。名字不在表里 → 拒,不是返空值:
// 沙箱问了个宿主不打算给的东西,该听见"不行",而不是以为 owner 没填。
func whitelistedField(row *entity.Owner, field string) (json.RawMessage, error) {
	served := map[string]string{
		"timezone":  row.ProfileTimezone,
		"full_name": row.FullName,
		"email":     row.Email,
	}
	val, ok := served[field]
	if !ok {
		return nil, fmt.Errorf("owner.meta: field %q not allowed", field)
	}
	out, err := json.Marshal(map[string]string{"value": val})
	if err != nil {
		return nil, fmt.Errorf("owner.meta: marshal: %w", err)
	}
	return out, nil
}
