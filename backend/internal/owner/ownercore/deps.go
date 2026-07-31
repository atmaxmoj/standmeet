// deps.go —— shared narrow interfaces / dep bundles for the owner-core caps (moved off mcphandle
// with the caps, #135). CalendarOwnerStore lives in cap_calendar.go.

package ownercore

import (
	"context"

	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
)

// OwnerLookup —— 读 owner 档案的窄口(*owner.Repo 天然满足)。
//
// 原本住在 me.go —— 那个能力已经搬进出站收口了,但 calendar 还要用它读 owner 的时区,
// 所以留在这儿,等 calendar 也搬走时一起消失。
type OwnerLookup interface {
	GetByID(ctx context.Context, ownerID string) (owner.Owner, error)
}

// SEOWriter —— seo.* + corpus SEO MCP tools 需要的最小接口（避开直接 import corpus.SEORepo）。
// 地址树派生，不再设 path —— 只写 SEO 描述 + indexed 开关。
type SEOWriter interface {
	UpdateWikiSEO(
		ctx context.Context, ownerID, wikiID, description string, indexed bool,
	) (corpus.Wiki, error)
	UpdateOutputSEO(
		ctx context.Context, ownerID, outputID, description string, indexed bool,
	) (corpus.Output, error)
	GetSettings(ctx context.Context, ownerID string) (corpus.SEOSettings, error)
	UpsertSettings(
		ctx context.Context, in *corpus.SEOSettings,
	) (corpus.SEOSettings, error)
}
