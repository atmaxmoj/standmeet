// homework.go —— composition root adapts the job loop's ApplicationRepo into the narrow port the
// visitor-side homework block needs: "the homework on this code's application's job".

package port

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"

	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsuc"
)

// HomeworkByCode —— constructor.
func HomeworkByCode(d *deps.Runtime) HomeworkReader {
	return HomeworkReader{repo: d.ApplicationRepo}
}

// HomeworkReader —— exported (revive unexported-return). Satisfies conversation.HomeworkSource.
type HomeworkReader struct{ repo *jobsuc.ApplicationRepo }

// HomeworkForCode —— the homework on the ledger row of the application this code was issued for.
func (r HomeworkReader) HomeworkForCode(
	ctx context.Context, ownerID, codeID string,
) (string, error) {
	text, err := r.repo.HomeworkByAccessCode(ctx, ownerID, codeID)
	if err != nil {
		return "", fmt.Errorf("homework for code: %w", err)
	}
	return text, nil
}
