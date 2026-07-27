// visitor_data_sources.go —— narrow data-source interfaces for the visitor
// agent's corpus retrieval + report persistence.
//
// F.2: the visitor agentic functionality (corpus tools, summarize) reads its
// data through these narrow ports instead of concrete *postgres repos, so the
// SAME agentic code can be driven with different backings: prod injects the
// postgres repos (which satisfy these as-is), the eval-harness injects in-memory
// fixtures. The agentic core stops being welded to the database.

package conversation

import (
	"context"
)

// corpus.WikiLister —— owner-scoped wiki corpus for retrieval (buildRetriever)。除了内存

// ReportStore —— summarize_conversation persistence + the report read path.
// #129 一会话一份:Upsert 按 conversation 改写原行(revise)，report_id 稳定。eval 的
// no-op store 忽略入参。
type ReportStore interface {
	Upsert(
		ctx context.Context, in *UpsertReportInput,
	) (ChatReport, error)
	GetByID(ctx context.Context, reportID string) (ChatReport, error)
}
