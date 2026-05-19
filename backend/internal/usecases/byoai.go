// byoai.go —— BYOAI settings 更新 use case。
// admin UI PUT /api/admin/byoai 来这里。验证 + 写库 + 返回更新后的 owner。

package usecases

import (
	"context"
	"fmt"

	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/postgres"
)

// BYOAIDeps —— UpdateBYOAI 需要的 repo（owners 包）。
type BYOAIDeps struct {
	Owners *postgres.OwnerRepo
}

// UpdateBYOAIInput —— PUT /api/admin/byoai 入参（owner_id 从 session 来）。
// 字段顺序按 govet fieldalignment：strings 先、slice 紧跟、bool 末尾。
type UpdateBYOAIInput struct {
	OwnerID   string
	Blurb     string
	Providers []string
	Enabled   bool
}

// UpdateBYOAI 把 byoai_enabled / providers / blurb 三字段一起写。返回新 owner。
// owner_id 不存在返 domain.ErrOwnerNotFound（handler 翻 401）。
func UpdateBYOAI(
	ctx context.Context, deps BYOAIDeps, in *UpdateBYOAIInput,
) (domain.Owner, error) {
	if in.OwnerID == "" {
		return domain.Owner{}, ErrEmptyField
	}
	owner, err := deps.Owners.UpdateBYOAI(ctx, &postgres.UpdateBYOAIInput{
		OwnerID:   in.OwnerID,
		Enabled:   in.Enabled,
		Providers: in.Providers,
		Blurb:     in.Blurb,
	})
	if err != nil {
		return domain.Owner{}, fmt.Errorf("update byoai: %w", err)
	}
	return owner, nil
}
