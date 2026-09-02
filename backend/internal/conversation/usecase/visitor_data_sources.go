// visitor_data_sources.go —— narrow data-source interfaces for the visitor
// agent's corpus retrieval + report persistence.
//
// F.2: the visitor agentic functionality (corpus tools, summarize) reads its
// data through these narrow ports instead of concrete *postgres repos, so the
// SAME agentic code can be driven with different backings: prod injects the
// postgres repos (which satisfy these as-is), the eval-harness injects in-memory
// fixtures. The agentic core stops being welded to the database.

package usecase

import (
	"context"

	"github.com/atmaxmoj/standmeet/internal/conversation/entity"
	"github.com/atmaxmoj/standmeet/internal/conversation/repo"
)

// corpus.WikiLister —— owner-scoped wiki corpus for retrieval (buildRetriever). Besides in-memory

// ReportStore —— summarize_conversation persistence + the report read path.
// #129 one report per conversation: Upsert rewrites the existing row keyed by
// conversation (revise), report_id stays stable. eval's no-op store ignores its input.
type ReportStore interface {
	Upsert(
		ctx context.Context, in *repo.UpsertReportInput,
	) (entity.ChatReport, error)
	GetByID(ctx context.Context, reportID string) (entity.ChatReport, error)
}
