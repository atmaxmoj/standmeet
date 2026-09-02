// domains.go — the admin CRUD use case for allowed_domains (the Caddy on-demand
// TLS allowlist). DNS verification is Caddy's job on the /internal/tls-ask side;
// here we only manage the instance_settings.allowed_domains jsonb array itself.

package usecase

import (
	"context"
	"fmt"
	"strings"

	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	"github.com/atmaxmoj/standmeet/internal/owner/repo"
)

// AllowedDomainsDeps — List / Add / Remove need InstanceRepo.
type AllowedDomainsDeps struct {
	Instance *repo.InstanceRepo
}

// ListAllowedDomains — returns the current allowlist (empty slice if none).
func ListAllowedDomains(
	ctx context.Context, deps AllowedDomainsDeps,
) ([]string, error) {
	list, err := deps.Instance.ListAllowedDomains(ctx)
	if err != nil {
		return nil, fmt.Errorf("list allowed domains: %w", err)
	}
	return list, nil
}

// AddAllowedDomain — adds a domain to the allowlist (normalize + dedupe).
// An empty string / invalid format returns apierr.ErrEmptyField; the caller maps that to 400.
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

// RemoveAllowedDomain — removes a domain from the allowlist. An empty string returns
// apierr.ErrEmptyField; removing one that doesn't exist is idempotent and errors nothing
// (repo already swallows that).
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

// normalizeDomain strips scheme + trailing slash + lowercases. Format validation is
// Caddy's job; this only does the minimal cleanup so "https://Example.com/" can be added too.
func normalizeDomain(dom string) string {
	s := strings.TrimSpace(dom)
	s = strings.TrimPrefix(s, "https://")
	s = strings.TrimPrefix(s, "http://")
	s = strings.TrimRight(s, "/")
	return strings.ToLower(s)
}
