// resume.go — composition root adapts the job-loop's ApplicationRepo into the narrow
// port for the visitor-side resume-reading capability. This capability only needs
// "fetch this resume's JSON by access code", it shouldn't depend on the whole
// ApplicationRepo, and conversation / capload definitely shouldn't know about
// jobsmodel — serialization is contained in this layer.
//
// not-found (an ordinary code with no application bound) returns error the same as a
// real failure: capability hides on any error unconditionally (fail-closed), so there's
// no need to tell the two apart, and thus no separate return path for it here.

package port

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"

	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsuc"
)

// ResumesByCode — constructor. Returns a port that can only "fetch this resume's JSON
// by access code".
func ResumesByCode(d *deps.Runtime) ResumeReader {
	return ResumeReader{repo: d.ApplicationRepo}
}

// ResumeReader — exported (revive unexported-return). Satisfies conversation.ResumeSource.
type ResumeReader struct{ repo *jobsuc.ApplicationRepo }

// ResumeForCode — looks up the application bound to this access code, returns its
// resume_content (JSON bytes). An ordinary code with no bound application → GetByAccessCode
// returns ErrApplicationNotFound, wrapped as an error and raised here (capability hides
// the tool based on that).
func (r ResumeReader) ResumeForCode(
	ctx context.Context, ownerID, codeID string,
) ([]byte, error) {
	app, err := r.repo.GetByAccessCode(ctx, ownerID, codeID)
	if err != nil {
		return []byte{}, fmt.Errorf("resume for code: %w", err)
	}
	out, merr := json.Marshal(app.ResumeContent)
	if merr != nil {
		return []byte{}, fmt.Errorf("marshal resume content: %w", merr)
	}
	return out, nil
}
