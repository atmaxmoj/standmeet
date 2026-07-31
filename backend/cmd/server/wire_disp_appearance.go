// wire_disp_appearance.go —— owner 自定义 CSS 的读写 → 出站收口的窄口。
//
// 写要走 owner.SetOwnerCSS(它负责 sanitize + scope),不能直接怼仓储 ——
// 那条规矩属于域,三个入口共用同一份。

package main

import (
	"context"
	"fmt"

	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
)

type appearanceOps struct{ store owner.CSSStore }

func newAppearanceOps(d *runtimeDeps) appearanceOps {
	return appearanceOps{store: d.ownerRepo}
}

func (a appearanceOps) GetCSS(ctx context.Context, ownerID string) (string, error) {
	css, err := a.store.GetCSS(ctx, ownerID)
	if err != nil {
		return "", fmt.Errorf("read owner css: %w", err)
	}
	return css, nil
}

func (a appearanceOps) SetCSS(ctx context.Context, ownerID, css string) error {
	if err := owner.SetOwnerCSS(ctx, a.store, ownerID, css); err != nil {
		return fmt.Errorf("save owner css: %w", err)
	}
	return nil
}
