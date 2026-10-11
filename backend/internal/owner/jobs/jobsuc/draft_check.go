// draft_check.go —— a draft checked against the owner's master (job-loop roadmap 5.1). Every draft
// write answers with the findings and never refuses — the owner is still editing; the commit is
// where an unaccepted finding stops (applications.go).

package jobsuc

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
)

// CheckAgainstMaster —— the draft's findings against its reference: the master it was based on as
// that master is NOW (a fact fixed after the draft was made shows up), else the default master,
// else none (coverage none).
func CheckAgainstMaster(
	ctx context.Context, masters *ResumeMasterRepo, ownerID, basedOn string,
	content *jobsmodel.ResumeContent,
) (jobsmodel.DraftCheck, error) {
	ref, err := referenceContent(ctx, masters, ownerID, basedOn)
	return jobsmodel.CheckDraft(ref.content, content), err
}

// reference —— the master content a draft is checked against; content nil = none.
type reference struct{ content *jobsmodel.ResumeContent }

func referenceContent(
	ctx context.Context, masters *ResumeMasterRepo, ownerID, basedOn string,
) (reference, error) {
	m, err := referenceMaster(ctx, masters, ownerID, basedOn)
	if errors.Is(err, jobsmodel.ErrResumeMasterNotFound) {
		return reference{}, nil
	}
	if err != nil {
		return reference{}, err
	}
	return reference{content: &m.ResumeContent}, nil
}

func referenceMaster(
	ctx context.Context, masters *ResumeMasterRepo, ownerID, basedOn string,
) (jobsmodel.ResumeMaster, error) {
	if basedOn != "" {
		m, err := masters.Get(ctx, ownerID, basedOn)
		if !errors.Is(err, jobsmodel.ErrResumeMasterNotFound) {
			return m, err
		}
	}
	return masters.GetDefault(ctx, ownerID)
}

// ErrDraftFindings —— the commit names a draft whose findings the owner has not all accepted.
var ErrDraftFindings = errors.New("this draft differs from your résumé master; accept each " +
	"change by its key (accept: [key, …]) or fix the draft")

// checkedDraft —— the draft's render inputs, once its findings are all accepted.
func checkedDraft(
	ctx context.Context, deps *ApplicationsDeps, ownerID, draftID string, accept []string,
) (DraftRenderData, error) {
	data, err := deps.Apps.GetDraftRenderData(ctx, ownerID, draftID)
	if err != nil {
		return DraftRenderData{}, fmt.Errorf("get draft render data: %w", err)
	}
	if gerr := gateFindings(ctx, deps, ownerID, &data, accept); gerr != nil {
		return DraftRenderData{}, gerr
	}
	return data, nil
}

// gateFindings —— the commit stops on any finding not accepted by key; the refusal names each
// field with the master value and the draft value. nil Masters = not checked (wired without).
func gateFindings(
	ctx context.Context, deps *ApplicationsDeps, ownerID string, data *DraftRenderData,
	accept []string,
) error {
	if deps.Masters == nil {
		return nil
	}
	check, err := CheckAgainstMaster(ctx, deps.Masters, ownerID, data.BasedOnMasterID, &data.Resume)
	if err != nil {
		return err
	}
	open := check.Unaccepted(accept)
	if len(open) == 0 {
		return nil
	}
	lines := make([]string, 0, len(open))
	for _, f := range open {
		lines = append(lines, fmt.Sprintf("%s (%s): master %q, draft %q", f.Key, f.Kind,
			f.Master, f.Draft))
	}
	return fmt.Errorf("%w: %s", ErrDraftFindings, strings.Join(lines, "; "))
}

// CommitCheck —— the findings a commit of this draft would be refused for (the panel's send dialog
// asks for each one before it sends).
func CommitCheck(
	ctx context.Context, deps *ApplicationsDeps, ownerID, draftID string,
) (jobsmodel.DraftCheck, error) {
	data, err := deps.Apps.GetDraftRenderData(ctx, ownerID, draftID)
	if err != nil {
		return jobsmodel.DraftCheck{}, fmt.Errorf("get draft: %w", err)
	}
	return CheckAgainstMaster(ctx, deps.Masters, ownerID, data.BasedOnMasterID, &data.Resume)
}

// withCheck —— the written draft, and its findings.
func withCheck(
	ctx context.Context, deps *ResumeDeps, draft *jobsmodel.ResumeDraft,
) (DraftedResume, error) {
	ref, err := referenceContent(ctx, deps.Masters, draft.OwnerID, draft.BasedOnMasterID)
	if err != nil {
		return DraftedResume{}, err
	}
	return DraftedResume{
		Draft:   *draft,
		Check:   jobsmodel.CheckDraft(ref.content, &draft.ResumeContent),
		Numbers: jobsmodel.CheckNumbers(ref.content, &draft.ResumeContent),
	}, nil
}
