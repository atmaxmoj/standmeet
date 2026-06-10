// writings_save_parent.go —— SaveWriting 的 parent_id 相关:落库前校验 parent
// 合法,两段写时保住 parent 不被 body-write 误清空。从 writings_save.go 拆出守
// max-lines。

package usecases

import (
	"context"
	"errors"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/domain"
)

// validateWritingParent —— parent_id 给了就必须是本 owner 的 writing(FK 只保
// id 存在,不管 owner)。找不到 → ErrParentNotFound,不挂无效父落孤儿。空 → root。
// 跟 wiki validateWikiParent 同口径。cycle(reparent)留给 admin reparent(#55)。
func validateWritingParent(ctx context.Context, deps WritingsTxDeps, in *SaveWritingInput) error {
	if in.ParentID == "" {
		return nil
	}
	if _, err := deps.Writings.GetByID(ctx, in.OwnerID, in.ParentID); err != nil {
		if errors.Is(err, domain.ErrWritingNotFound) {
			return domain.ErrParentNotFound
		}
		return fmt.Errorf("validate writing parent: %w", err)
	}
	return nil
}

// effectiveWritingParent —— body-write 是全字段覆盖,会重写 parent_id。input 显式
// 给了就用(create / reparent);没给则保留 shell-create / 既有行的 parent,避免
// 普通编辑误清空(SaveWriting 两段写,a.Writing 已带 shell/既有 parent)。
func effectiveWritingParent(a *writeBodyArgs) string {
	if a.In.ParentID != "" {
		return a.In.ParentID
	}
	pid, _ := a.Writing.ParentID()
	return pid
}
