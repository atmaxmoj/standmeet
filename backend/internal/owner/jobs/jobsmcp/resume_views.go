// resume_views.go — JSON shapes for the text-content part of resume.* tool responses.
// PDF isn't here — PDF goes back via EmbeddedResource (base64 blob), returned in
// parallel with the structured data.

package jobsmcp

import "github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"

// resumeDraftViewT — the text part returned by draft / update_draft. The owner sees
// this JSON plus an embedded PDF on the Claude side; the AI can use draft.id to call
// update / commit.
type resumeDraftViewT struct {
	ID          string         `json:"draft_id"`
	JobCacheID  string         `json:"job_cache_id"`
	ExpiresAt   string         `json:"expires_at"`
	CreatedAt   string         `json:"created_at"`
	JobSnapshot fetchedJobView `json:"job_snapshot"`
}

func resumeDraftView(d *jobsmodel.ResumeDraft) resumeDraftViewT {
	return resumeDraftViewT{
		ID:          d.ID,
		JobCacheID:  d.JobCacheID,
		JobSnapshot: fetchedJobToView(&d.JobSnapshot),
		ExpiresAt:   d.ExpiresAt.Format(mcpTimeFmt),
		CreatedAt:   d.CreatedAt.Format(mcpTimeFmt),
	}
}
