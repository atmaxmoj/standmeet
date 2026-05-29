// marketplace.go —— skill marketplace search usecase. Thin wrapper
// around marketplace.Client so the admin REST layer doesn't reach
// directly into the marketplace package (arch-lint convention).
//
// Install + SKILL.md fetch land in a later phase; this surface is
// search-only.

package usecases

import (
	"context"

	"github.com/wangsijie/standmeet/internal/domain"
)

// MarketplaceClient —— matches marketplace.Client. Interfaces lets us
// stub the network out in usecase-level tests.
type MarketplaceClient interface {
	Search(ctx context.Context, query, source string) []domain.MarketSkill
}

// MarketplaceDeps —— bundle for the marketplace search REST route.
type MarketplaceDeps struct {
	Client MarketplaceClient
}

// SearchMarketplace —— delegates to the injected client. The caller
// translates HTTP query params into (query, source); we don't validate
// `source` here because the client falls back to "all" on unknown
// values.
func SearchMarketplace(
	ctx context.Context, deps MarketplaceDeps, query, source string,
) []domain.MarketSkill {
	return deps.Client.Search(ctx, query, source)
}
