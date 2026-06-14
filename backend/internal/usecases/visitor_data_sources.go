// visitor_data_sources.go —— narrow data-source interfaces for the visitor
// agent's corpus retrieval + report persistence.
//
// F.2: the visitor agentic functionality (corpus tools, summarize) reads its
// data through these narrow ports instead of concrete *postgres repos, so the
// SAME agentic code can be driven with different backings: prod injects the
// postgres repos (which satisfy these as-is), the eval-harness injects in-memory
// fixtures. The agentic core stops being welded to the database.

package usecases

import (
	"context"

	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/postgres"
)

// WikiLister —— owner-scoped wiki corpus for retrieval (buildRetriever)。除了内存
// 窗口的 ListByOwner,加上 DB 懒加载三件套:全量搜(Search)、按 id 读 meta
// (GetMetaByID,上溯算 path)、按 id 读正文(GetByID)。prod *postgres.WikiRepo
// 原样满足;eval-harness 内存 fixture 需补这三个。
type WikiLister interface {
	ListByOwner(ctx context.Context, ownerID string, limit int32) ([]domain.Wiki, error)
	Search(
		ctx context.Context, ownerID, query string, limit, offset int32,
	) ([]postgres.WikiMeta, error)
	GetMetaByID(ctx context.Context, ownerID, id string) (postgres.WikiMeta, error)
	GetByID(ctx context.Context, ownerID, id string) (domain.Wiki, error)
}

// OutputLister —— owner-scoped output corpus for retrieval.
type OutputLister interface {
	ListByOwner(ctx context.Context, ownerID string, limit int32) ([]domain.Output, error)
}

// WritingLister —— owner-scoped published writings for retrieval.
type WritingLister interface {
	ListPublishedByOwner(ctx context.Context, ownerID string) ([]domain.Writing, error)
}

// ReportStore —— summarize_conversation persistence + the report read path.
// Create still takes *postgres.CreateReportInput (the shared wire shape); the
// eval's no-op store ignores it.
type ReportStore interface {
	Create(ctx context.Context, in *postgres.CreateReportInput) (domain.ChatReport, error)
	GetByID(ctx context.Context, reportID string) (domain.ChatReport, error)
}
