// page_save.go —— 读一份主页内容、存一份主页内容,这两件事**本身**的规则。
//
// 两条以前长在面上:
//
//   - 还没有内容时给一份默认草稿(owner 基于它改,而不是从空白起步)。
//   - 存之前要校验 pin 列表:pin 的每一条都得是已公开的(pinned ⊆ published)。
//
// 谁来存都一样,所以住在域里。

package usecase

import (
	"context"
	"errors"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/owner/entity"
	"github.com/atmaxmoj/standmeet/internal/owner/repo"
)

// PageContentOrDefault —— 当前内容;还没有就给默认草稿。
func PageContentOrDefault(
	ctx context.Context, owners *repo.Repo, ownerID string,
) (entity.PageContent, error) {
	content, err := owners.GetPageContent(ctx, ownerID)
	if err == nil {
		return content, nil
	}
	if errors.Is(err, entity.ErrPageNotFound) {
		return DefaultPageContent(ownerID), nil
	}
	return entity.PageContent{}, fmt.Errorf("read page content: %w", err)
}

// SavePageContent —— 校验 pin 列表后整段存下。
func SavePageContent(
	ctx context.Context, pins PagePinDeps, ownerID string, content *entity.PageContent,
) (entity.PageContent, error) {
	content.OwnerID = ownerID
	if err := ValidatePagePins(ctx, pins, ownerID, content); err != nil {
		return entity.PageContent{}, fmt.Errorf("validate page pins: %w", err)
	}
	saved, err := pins.Owners.UpsertPageContent(ctx, ownerID, content)
	if err != nil {
		return entity.PageContent{}, fmt.Errorf("save page content: %w", err)
	}
	return saved, nil
}
