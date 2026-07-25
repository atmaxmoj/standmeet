// deps.go —— shared narrow interfaces / dep bundles for the owner-core caps (moved off mcphandle
// with the caps, #135). OwnerLookup lives in me.go, CalendarOwnerStore in cap_calendar.go.

package ownercore

import (
	"context"

	"github.com/atmaxmoj/standmeet/internal/connector/contract"
	"github.com/atmaxmoj/standmeet/internal/domain"
)

// SEOWriter —— seo.* + corpus SEO MCP tools 需要的最小接口（避开直接 import postgres.SEORepo）。
// 地址树派生，不再设 path —— 只写 SEO 描述 + indexed 开关。
type SEOWriter interface {
	UpdateWikiSEO(
		ctx context.Context, ownerID, wikiID, description string, indexed bool,
	) (domain.Wiki, error)
	UpdateOutputSEO(
		ctx context.Context, ownerID, outputID, description string, indexed bool,
	) (domain.Output, error)
	GetSettings(ctx context.Context, ownerID string) (domain.SEOSettings, error)
	UpsertSettings(ctx context.Context, in *domain.SEOSettings) (domain.SEOSettings, error)
}

// CalendarOwnerDeps —— newCalendarCapability 入参打包（connector proxy + calendar store）。
type CalendarOwnerDeps struct {
	Proxy contract.CalendarProxy
	Store CalendarOwnerStore
}
