// handle.go —— owner 改 handle 的 usecase。校验 + 转交 repo（repo 内 tx
// 保证原子 UPDATE owners + INSERT handle_aliases）。

package usecases

import (
	"context"
	"fmt"
	"strings"

	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/postgres"
)

// HandleDeps —— UpdateOwnerHandle 依赖。
type HandleDeps struct {
	Owners *postgres.OwnerRepo
}

const (
	maxHandleLen = 64
	minHandleLen = 2
)

// UpdateOwnerHandle —— admin "change handle" 的入口。校验：a-z0-9- + 2-64
// 字符；新 handle 跟旧一致直接返当前。返 ErrHandleTaken 让 routes 翻译 409。
func UpdateOwnerHandle(
	ctx context.Context, deps HandleDeps, ownerID, raw string,
) (domain.Owner, error) {
	h := strings.ToLower(strings.TrimSpace(raw))
	if !validHandle(h) {
		return domain.Owner{}, fmt.Errorf("%w: handle must be %d-%d chars of a-z0-9-",
			ErrEmptyField, minHandleLen, maxHandleLen)
	}
	owner, err := deps.Owners.UpdateHandle(ctx, ownerID, h)
	if err != nil {
		return domain.Owner{}, fmt.Errorf("update handle: %w", err)
	}
	return owner, nil
}

func validHandle(h string) bool {
	if len(h) < minHandleLen || len(h) > maxHandleLen {
		return false
	}
	for _, r := range h {
		if !isHandleChar(r) {
			return false
		}
	}
	return true
}

func isHandleChar(r rune) bool {
	if r == '-' {
		return true
	}
	return isLowerAlnum(r)
}
