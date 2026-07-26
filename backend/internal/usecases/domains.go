// domains.go —— allowed_domains（Caddy on-demand TLS 白名单）的 admin
// CRUD use case。verify DNS 是 Caddy 侧 /internal/tls-ask 的事；这里
// 只管 instance_settings.allowed_domains 这个 jsonb 数组本身。

package usecases

import (
	"context"
	"fmt"
	"strings"

	"github.com/atmaxmoj/standmeet/internal/apierr"
	"github.com/atmaxmoj/standmeet/internal/owner"
)

// AllowedDomainsDeps —— List / Add / Remove 需要 InstanceRepo。
type AllowedDomainsDeps struct {
	Instance *owner.InstanceRepo
}

// ListAllowedDomains —— 返当前白名单（empty slice if none）。
func ListAllowedDomains(
	ctx context.Context, deps AllowedDomainsDeps,
) ([]string, error) {
	list, err := deps.Instance.ListAllowedDomains(ctx)
	if err != nil {
		return nil, fmt.Errorf("list allowed domains: %w", err)
	}
	return list, nil
}

// AddAllowedDomain —— 把 domain 加进白名单（normalize + 去重）。
// 空字符串 / 无效格式返 apierr.ErrEmptyField；调用方据此返 400。
func AddAllowedDomain(
	ctx context.Context, deps AllowedDomainsDeps, dom string,
) error {
	n := normalizeDomain(dom)
	if n == "" {
		return apierr.ErrEmptyField
	}
	if err := deps.Instance.AddAllowedDomain(ctx, n); err != nil {
		return fmt.Errorf("add allowed domain: %w", err)
	}
	return nil
}

// RemoveAllowedDomain —— 从白名单删 domain。空串返 apierr.ErrEmptyField；
// 不存在 idempotent 不报错（repo 已经吞了）。
func RemoveAllowedDomain(
	ctx context.Context, deps AllowedDomainsDeps, dom string,
) error {
	n := normalizeDomain(dom)
	if n == "" {
		return apierr.ErrEmptyField
	}
	if err := deps.Instance.RemoveAllowedDomain(ctx, n); err != nil {
		return fmt.Errorf("remove allowed domain: %w", err)
	}
	return nil
}

// normalizeDomain 去 scheme + 末尾斜杠 + 小写。format 校验交 Caddy；这里
// 只做最小化处理，让 "https://Example.com/" 也能 add。
func normalizeDomain(dom string) string {
	s := strings.TrimSpace(dom)
	s = strings.TrimPrefix(s, "https://")
	s = strings.TrimPrefix(s, "http://")
	s = strings.TrimRight(s, "/")
	return strings.ToLower(s)
}
