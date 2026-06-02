// visitor_chat.go —— shared retrieval-corpus loader used by agent-skills
// retrieval capability + tool dispatcher.
//
// Server-side SendMessage usecase + streamReply agent loop both got
// deleted in G-Y.6 (pi-pivot moved all chat orchestration into the
// browser via pi-agent-core). The only piece this file still owns:
// loading the owner's corpus into a retriever the per-session
// `corpus.retrieval` capability can wrap.

package usecases

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/domain"
)

const (
	maxRAGWikis   = 50
	maxRAGOutputs = 50
)

// retrieverBuildInput —— buildRetriever input (owner_id + required
// snapshot for ACL gating).
type retrieverBuildInput struct {
	snapshot *domain.RoleSnapshot
	ownerID  string
}

// buildRetriever —— load wiki + output + posts for the tool executor.
// retrieval phase doesn't ACL-filter; ACL is evaluated per-call by the
// tool against the URI in question (search filters; read denies). So
// ACL denies surface to the AI as "not found" rather than "missing from
// corpus".
//
// ACL routes through `role_snapshot`.AllowsCorpus —— A.3-IAM-5 onward
// every session has a snapshot (code → assumed_role_id; public/byoai →
// owner vanilla).
//
// posts: only published; drafts stay out of visitor scope.
func buildRetriever(
	ctx context.Context, deps *VisitorDeps, in *retrieverBuildInput,
) (*retriever, error) {
	wikis, werr := deps.Wiki.ListByOwner(ctx, in.ownerID, maxRAGWikis)
	if werr != nil {
		return nil, fmt.Errorf("list wiki for retrieval: %w", werr)
	}
	outputs, oerr := deps.Output.ListByOwner(ctx, in.ownerID, maxRAGOutputs)
	if oerr != nil {
		return nil, fmt.Errorf("list output for retrieval: %w", oerr)
	}
	writings := listWritingsForRetrieval(ctx, deps, in.ownerID)
	return newRetriever(&retrieverInput{
		wikis: wikis, outputs: outputs, writings: writings,
		snapshot: in.snapshot,
	}), nil
}

func listWritingsForRetrieval(
	ctx context.Context, deps *VisitorDeps, ownerID string,
) []domain.Writing {
	if deps.Writings == nil {
		return []domain.Writing{}
	}
	writings, err := deps.Writings.ListPublishedByOwner(ctx, ownerID)
	if err != nil {
		return []domain.Writing{}
	}
	return writings
}
