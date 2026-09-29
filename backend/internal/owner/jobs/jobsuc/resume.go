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
	"encoding/json"
	"errors"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	jobcache "github.com/atmaxmoj/standmeet/internal/owner/jobs/cache"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
)

// ResumeDeps — dependencies for the resume.* usecases.
type ResumeDeps struct {
	Drafts  *ResumeDraftRepo
	Masters *ResumeMasterRepo
	Cache   *jobcache.Pool
}

// DraftedResume — the return value of resume.draft / update_draft. Structured
// view only; the PDF is rendered live by the admin browser (React
// `ResumePage`), never by the server.
type DraftedResume struct {
	Draft jobsmodel.ResumeDraft
}

// DraftInput — the input to resume.draft (packed into a struct: content +
// chosen template + target job). MasterID names the master the draft starts
// from: its content when Content is nil, and the draft's based_on either way.
type DraftInput struct {
	Content    *jobsmodel.ResumeContent
	JobCacheID string
	Template   string
	MasterID   string
}

// DraftResume — Claude calls resume.draft: pulls the job snapshot from the
// Redis pool and writes the draft row.
func DraftResume(
	ctx context.Context, deps ResumeDeps, ownerID string, in DraftInput,
) (DraftedResume, error) {
	seed, err := draftContent(ctx, &deps, ownerID, &in)
	if err != nil {
		return DraftedResume{}, err
	}
	snapshot, err := loadJobSnapshot(ctx, deps, ownerID, in.JobCacheID)
	if err != nil {
		return DraftedResume{}, err
	}
	draft, err := deps.Drafts.Create(ctx, &jobsmodel.CreateResumeDraftInput{
		OwnerID:         ownerID,
		JobCacheID:      in.JobCacheID,
		JobSnapshot:     snapshot,
		ResumeContent:   seed.Content,
		Template:        in.Template,
		BasedOnMasterID: seed.MasterID,
	})
	if err != nil {
		return DraftedResume{}, fmt.Errorf("create draft: %w", err)
	}
	return DraftedResume{Draft: draft}, nil
}

// ManualDraftInput — the owner starts a draft by hand from the panel, with no
// cached job behind it. Company is required; the rest are optional. MasterID is
// the master to start from; Blank asks for an empty résumé even when a default
// master exists; neither = the default master, else blank.
type ManualDraftInput struct {
	Company  string
	Role     string
	JobURL   string
	JobText  string
	MasterID string
	Blank    bool
}

// CreateManualDraft — the panel's "new draft" button. No Redis job to snapshot,
// so the snapshot is built straight from what the owner typed; resume_content
// comes from the chosen master, else the default master, else blank
// (docs/design/resume-masters.md — this replaced "copy the newest draft", which
// started blank after any quiet day).
func CreateManualDraft(
	ctx context.Context, deps ResumeDeps, ownerID string, in *ManualDraftInput,
) (DraftedResume, error) {
	if ownerID == "" || in.Company == "" {
		return DraftedResume{}, apierr.ErrEmptyField
	}
	seed, err := manualStart(ctx, &deps, ownerID, in)
	if err != nil {
		return DraftedResume{}, err
	}
	draft, err := deps.Drafts.Create(ctx, &jobsmodel.CreateResumeDraftInput{
		OwnerID:    ownerID,
		JobCacheID: "",
		JobSnapshot: jobsmodel.FetchedJob{
			Company: in.Company, Title: in.Role, URL: in.JobURL, BodyText: in.JobText,
		},
		ResumeContent:   seed.Content,
		BasedOnMasterID: seed.MasterID,
	})
	if err != nil {
		return DraftedResume{}, fmt.Errorf("create manual draft: %w", err)
	}
	return DraftedResume{Draft: draft}, nil
}

// manualStart — a hand-made draft's content: blank when asked, else from a master.
func manualStart(
	ctx context.Context, deps *ResumeDeps, ownerID string, in *ManualDraftInput,
) (masterSeed, error) {
	if in.Blank {
		return masterSeed{Content: blankResumeContent()}, nil
	}
	return masterStart(ctx, deps, ownerID, in.MasterID)
}

// draftContent — resume.draft's content: what the agent wrote, else the named master's. A named
// master must be the owner's (the lookup is owner-scoped) and is recorded as the draft's based_on.
func draftContent(
	ctx context.Context, deps *ResumeDeps, ownerID string, in *DraftInput,
) (masterSeed, error) {
	if !draftInputComplete(ownerID, in) {
		return masterSeed{}, jobsmodel.ErrResumeDraftIncomplete
	}
	if in.MasterID == "" {
		return masterSeed{Content: *in.Content}, nil
	}
	seed, err := masterStart(ctx, deps, ownerID, in.MasterID)
	if err == nil && in.Content != nil {
		seed.Content = *in.Content
	}
	return seed, err
}

// draftInputComplete — resume.draft needs an owner, a job, and content or a master to copy it from.
func draftInputComplete(ownerID string, in *DraftInput) bool {
	return ownerID != "" && in.JobCacheID != "" && (in.Content != nil || in.MasterID != "")
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

// SaveDraftInput — the admin composer's save payload (bundled to stay under the argument limit).
// PuckData is the Puck editor state, passed through verbatim (nil = don't retain editor state).
type SaveDraftInput struct {
	Content  *jobsmodel.ResumeContent
	OwnerID  string
	DraftID  string
	Template string
	PuckData json.RawMessage
}

// SaveResumeDraft — the admin composer's save: persist edited content + the chosen Typst template
// together. Distinct from UpdateResumeDraft (MCP, content-only) because the panel is the only
// surface that picks a template.
func SaveResumeDraft(
	ctx context.Context, deps ResumeDeps, in *SaveDraftInput,
) (DraftedResume, error) {
	if err := requireFields(in.OwnerID, in.DraftID, in.Content); err != nil {
		return DraftedResume{}, err
	}
	draft, err := deps.Drafts.UpdateContentAndTemplate(ctx, &UpdateDraftFull{
		OwnerID: in.OwnerID, DraftID: in.DraftID, Content: in.Content,
		Template: in.Template, PuckData: in.PuckData,
	})
	if err != nil {
		return DraftedResume{}, fmt.Errorf("save draft: %w", err)
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
