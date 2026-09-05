// resume.go — Phase 2 resume draft usecase. Claude hands in
// (job_cache_id + resume_content) via MCP `resume.draft`:
//   1. pull the FetchedJob out of the Redis pool as a snapshot (fixed at
//      draft creation, no longer dependent on the cache)
//   2. write the resume_drafts row (1d TTL, same cycle as Redis)
//
// This step does not render a PDF — the owner previews it live as the React
// `ResumePage` in the admin browser, and downloads via the browser's own
// print / save if they want a copy. `applications.commit` is the step that
// renders the final PDF through gotenberg (with the real AccessCode QR).
//
// This way draft / preview never depend on the sidecar and editing feels
// instant; the server only holds structured state.

package jobsuc

import (
	"context"
	"errors"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	jobcache "github.com/atmaxmoj/standmeet/internal/owner/jobs/cache"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
)

// ResumeDeps — dependencies for the resume.* usecases.
type ResumeDeps struct {
	Drafts *ResumeDraftRepo
	Cache  *jobcache.Pool
}

// DraftedResume — the return value of resume.draft / update_draft. Structured
// view only; the PDF is rendered live by the admin browser (React
// `ResumePage`), never by the server.
type DraftedResume struct {
	Draft jobsmodel.ResumeDraft
}

// DraftInput — the input to resume.draft (packed into a struct: content +
// chosen template + target job).
type DraftInput struct {
	Content    *jobsmodel.ResumeContent
	JobCacheID string
	Template   string
}

// DraftResume — Claude calls resume.draft: pulls the job snapshot from the
// Redis pool and writes the draft row.
func DraftResume(
	ctx context.Context, deps ResumeDeps, ownerID string, in DraftInput,
) (DraftedResume, error) {
	if err := requireFields(ownerID, in.JobCacheID, in.Content); err != nil {
		return DraftedResume{}, err
	}
	snapshot, err := loadJobSnapshot(ctx, deps, ownerID, in.JobCacheID)
	if err != nil {
		return DraftedResume{}, err
	}
	draft, err := deps.Drafts.Create(ctx, &jobsmodel.CreateResumeDraftInput{
		OwnerID:       ownerID,
		JobCacheID:    in.JobCacheID,
		JobSnapshot:   snapshot,
		ResumeContent: *in.Content,
		Template:      in.Template,
	})
	if err != nil {
		return DraftedResume{}, fmt.Errorf("create draft: %w", err)
	}
	return DraftedResume{Draft: draft}, nil
}

// ManualDraftInput — the owner starts a draft by hand from the panel, with no
// cached job behind it. Company is required; the rest are optional.
type ManualDraftInput struct {
	Company string
	Role    string
	JobURL  string
	JobText string
}

// CreateManualDraft — the panel's "new draft" button. No Redis job to snapshot,
// so the snapshot is built straight from what the owner typed; resume_content is
// carried over from their most recent draft, so a second application starts from
// the first rather than blank.
// ponytail: carry-over is from prior drafts only, not sent applications — the
// first-ever manual draft opens empty. Fold applications in if owners ask.
func CreateManualDraft(
	ctx context.Context, deps ResumeDeps, ownerID string, in ManualDraftInput,
) (DraftedResume, error) {
	if ownerID == "" || in.Company == "" {
		return DraftedResume{}, apierr.ErrEmptyField
	}
	content, err := seedResumeContent(ctx, deps, ownerID)
	if err != nil {
		return DraftedResume{}, err
	}
	draft, err := deps.Drafts.Create(ctx, &jobsmodel.CreateResumeDraftInput{
		OwnerID:    ownerID,
		JobCacheID: "",
		JobSnapshot: jobsmodel.FetchedJob{
			Company: in.Company, Title: in.Role, URL: in.JobURL, BodyText: in.JobText,
		},
		ResumeContent: content,
	})
	if err != nil {
		return DraftedResume{}, fmt.Errorf("create manual draft: %w", err)
	}
	return DraftedResume{Draft: draft}, nil
}

// seedResumeContent — carry the owner's most recent draft content into a fresh
// manual draft (ListByOwner is created_at DESC, so [0] is newest); empty if none.
func seedResumeContent(
	ctx context.Context, deps ResumeDeps, ownerID string,
) (jobsmodel.ResumeContent, error) {
	prior, err := deps.Drafts.ListByOwner(ctx, ownerID)
	if err != nil {
		return jobsmodel.ResumeContent{}, fmt.Errorf("list prior drafts: %w", err)
	}
	if len(prior) > 0 {
		return prior[0].ResumeContent, nil
	}
	// Empty content, but with initialized slices: a nil slice marshals to JSON
	// null, and the reader's schema takes an array (default([]) fills undefined,
	// not null), so nil would fail the parse and the card would never render.
	return jobsmodel.ResumeContent{
		Works:      []jobsmodel.ResumeWork{},
		Educations: []jobsmodel.ResumeEducation{},
		Skills:     []jobsmodel.ResumeSkillSet{},
	}, nil
}

// UpdateResumeDraft — Claude calls resume.update_draft to adjust content.
// job_snapshot stays fixed (it was frozen at draft creation).
func UpdateResumeDraft(
	ctx context.Context, deps ResumeDeps, ownerID, draftID string,
	content *jobsmodel.ResumeContent,
) (DraftedResume, error) {
	if err := requireFields(ownerID, draftID, content); err != nil {
		return DraftedResume{}, err
	}
	draft, err := deps.Drafts.UpdateContent(ctx, ownerID, draftID, content)
	if err != nil {
		return DraftedResume{}, fmt.Errorf("update draft: %w", err)
	}
	return DraftedResume{Draft: draft}, nil
}

func requireFields(s1, s2 string, content *jobsmodel.ResumeContent) error {
	if s1 == "" || s2 == "" || content == nil {
		return apierr.ErrEmptyField
	}
	return nil
}

func loadJobSnapshot(
	ctx context.Context, deps ResumeDeps, ownerID, jobCacheID string,
) (jobsmodel.FetchedJob, error) {
	snapshot, err := deps.Cache.Get(ctx, ownerID, jobCacheID)
	if err != nil {
		if errors.Is(err, jobcache.ErrCacheMiss) {
			return jobsmodel.FetchedJob{}, jobsmodel.ErrJobCacheMiss
		}
		return jobsmodel.FetchedJob{}, fmt.Errorf("cache get: %w", err)
	}
	return snapshot, nil
}

// DiscardResumeDraft — resume.discard_draft; idempotent (a mismatched owner
// or an already-deleted draft both succeed silently).
func DiscardResumeDraft(ctx context.Context, deps ResumeDeps, ownerID, draftID string) error {
	if ownerID == "" || draftID == "" {
		return apierr.ErrEmptyField
	}
	if err := deps.Drafts.Delete(ctx, ownerID, draftID); err != nil {
		return fmt.Errorf("delete draft: %w", err)
	}
	return nil
}
