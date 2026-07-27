// byoai.go —— BYOAI settings 更新 use case。
// admin UI PUT /api/admin/byoai 来这里。验证 + 写库 + 返回更新后的 owner。

package owner

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
)

// BYOAIDeps —— UpdateBYOAI 需要的 repo（owners 包）。
type BYOAIDeps struct {
	Owners *Repo
}

// UpdateBYOAIInputReq —— PUT /api/admin/byoai 入参（owner_id 从 session 来）。
// 字段顺序按 govet fieldalignment：strings 先、slice 紧跟、bool 末尾。
type UpdateBYOAIInputReq struct {
	OwnerID   string
	Blurb     string
	Providers []string
	Enabled   bool
}

// UpdateBYOAI 把 byoai_enabled / providers / blurb 三字段一起写，返回新
// OwnerSettings（aggregate 的 setting 切面，不含 identity）。
// owner_id 不存在返 ErrOwnerNotFound（handler 翻 401）。
func UpdateBYOAI(
	ctx context.Context, deps BYOAIDeps, in *UpdateBYOAIInputReq,
) (Settings, error) {
	if in.OwnerID == "" {
		return Settings{}, apierr.ErrEmptyField
	}
	s, err := deps.Owners.UpdateBYOAI(ctx, &UpdateBYOAIInput{
		OwnerID:   in.OwnerID,
		Enabled:   in.Enabled,
		Providers: in.Providers,
		Blurb:     in.Blurb,
	})
	if err != nil {
		return Settings{}, fmt.Errorf("update byoai: %w", err)
	}
	return s, nil
}
