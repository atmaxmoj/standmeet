// owner_public_url.go —— owner 改部署的 canonical public URL 的 usecase。
// 校验同 claim：必须 http(s):// + 非空 host。normalize 去末尾斜杠。
// QR / SEO canonical 都以 owner.public_url 为单一来源 —— 见
// applications.go 的 buildQRURL。

package owner

import (
	"context"
	"fmt"
	"strings"

	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
)

// PublicURLDeps —— UpdateOwnerPublicURL 的依赖。
type PublicURLDeps struct {
	Owners *Repo
}

// UpdateOwnerPublicURL —— admin "change public URL" 入口。raw 经 trim/normalize
// 后做 scheme 校验；通过则写库返回新 owner row。
// 复用 ErrPublicURLInvalid（claim 同款 sentinel），让 routes 翻译 400。
func UpdateOwnerPublicURL(
	ctx context.Context, deps PublicURLDeps, ownerID, raw string,
) (Owner, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return Owner{}, apierr.ErrEmptyField
	}
	if !ValidPublicURL(trimmed) {
		return Owner{}, ErrPublicURLInvalid
	}
	normalized := NormalizePublicURL(trimmed)
	updated, err := deps.Owners.UpdatePublicURL(ctx, ownerID, normalized)
	if err != nil {
		return Owner{}, fmt.Errorf("update public_url: %w", err)
	}
	return updated, nil
}
