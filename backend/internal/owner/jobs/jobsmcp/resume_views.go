// resume_views.go — JSON shapes for the text-content part of resume.* tool responses.
// PDF isn't here — PDF goes back via EmbeddedResource (base64 blob), returned in
// parallel with the structured data.

package jobsmcp

import "github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"

// resumeDraftViewT — the text part returned by draft / update_draft. The owner sees
// this JSON plus an embedded PDF on the Claude side; the AI can use draft.id to call
// update / commit. resume_content is the draft's content (a draft started from a
// master carries the master's), so the AI tailors from what is actually there.
type resumeDraftViewT struct {
	ID              string                  `json:"draft_id"`
	JobCacheID      string                  `json:"job_cache_id"`
	ExpiresAt       string                  `json:"expires_at"`
	CreatedAt       string                  `json:"created_at"`
	BasedOnMasterID string                  `json:"based_on_master_id,omitempty"`
	JobSnapshot     fetchedJobView          `json:"job_snapshot"`
	ResumeContent   jobsmodel.ResumeContent `json:"resume_content"`
}

func resumeDraftView(d *jobsmodel.ResumeDraft) resumeDraftViewT {
	return resumeDraftViewT{
		ID:              d.ID,
		JobCacheID:      d.JobCacheID,
		JobSnapshot:     fetchedJobToView(&d.JobSnapshot),
		ExpiresAt:       d.ExpiresAt.Format(mcpTimeFmt),
		CreatedAt:       d.CreatedAt.Format(mcpTimeFmt),
		BasedOnMasterID: d.BasedOnMasterID,
		ResumeContent:   d.ResumeContent,
	}
}
