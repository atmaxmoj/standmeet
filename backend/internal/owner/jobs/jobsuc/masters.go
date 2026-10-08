// masters.go — résumé-master usecases (docs/design/resume-masters.md). The admin REST face and the
// owner MCP face both call these, so the two cannot do different things for the same request.
//
// A master is resume_content only. Saving a draft as a master copies the draft's content (and
// labels it with the draft's company); the draft is unchanged and keeps its expiry. A new draft
// starts from the chosen master, else the default master, else blank.

package jobsuc

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/paging"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
)

// CreateMasterInput — master_create: from a draft (DraftID), from given content, or blank.
type CreateMasterInput struct {
	Content   *jobsmodel.ResumeContent
	OwnerID   string
	Name      string
	DraftID   string
	IsDefault bool
}

// UpdateMasterInput — master_update: each nil field is left as it is.
type UpdateMasterInput struct {
	Name      *string
	Content   *jobsmodel.ResumeContent
	IsDefault *bool
	OwnerID   string
	MasterID  string
}

// SaveAsMasterInput — draft_save_as_master: overwrite MasterID, or (MasterID empty) a new master
// called Name. MakeDefault makes the written master the default.
type SaveAsMasterInput struct {
	OwnerID     string
	DraftID     string
	MasterID    string
	Name        string
	MakeDefault bool
}

// masterSeed — where a résumé's content comes from: the content, and the master (or draft
// company) it was copied from.
type masterSeed struct {
	MasterID string
	Company  string
	Content  jobsmodel.ResumeContent
}

// ListMasters — one page of the owner's masters.
func ListMasters(
	ctx context.Context, deps *ResumeDeps, ownerID string, req paging.Request,
) (paging.Page[jobsmodel.ResumeMaster], error) {
	page, err := deps.Masters.ListPage(ctx, ownerID, req)
	if err != nil {
		return page, fmt.Errorf("list masters: %w", err)
	}
	return page, nil
}

// GetMaster — one master.
func GetMaster(
	ctx context.Context, deps *ResumeDeps, ownerID, id string,
) (jobsmodel.ResumeMaster, error) {
	m, err := deps.Masters.Get(ctx, ownerID, id)
	if err != nil {
		return m, fmt.Errorf("get master: %w", err)
	}
	return m, nil
}

// CreateMaster — a new master; from a draft's content when DraftID is set.
func CreateMaster(
	ctx context.Context, deps *ResumeDeps, in *CreateMasterInput,
) (jobsmodel.ResumeMaster, error) {
	name := strings.TrimSpace(in.Name)
	if name == "" {
		return jobsmodel.ResumeMaster{}, jobsmodel.ErrResumeMasterNameRequired
	}
	seed, err := createSeed(ctx, deps, in)
	if err != nil {
		return jobsmodel.ResumeMaster{}, err
	}
	m, err := deps.Masters.Create(ctx, in.OwnerID, name, seed.Company, &seed.Content)
	if err != nil {
		return m, fmt.Errorf("create master: %w", err)
	}
	return applyDefault(ctx, deps, &m, &in.IsDefault)
}

// createSeed — a new master's content: the draft's, the given content, or blank.
func createSeed(ctx context.Context, deps *ResumeDeps, in *CreateMasterInput) (masterSeed, error) {
	switch {
	case in.DraftID != "":
		draft, err := deps.Drafts.GetByID(ctx, in.OwnerID, in.DraftID)
		if err != nil {
			return masterSeed{}, fmt.Errorf("master from draft: %w", err)
		}
		return masterSeed{Content: draft.ResumeContent, Company: draft.JobSnapshot.Company}, nil
	case in.Content != nil:
		return masterSeed{Content: *in.Content}, nil
	default:
		return masterSeed{Content: blankResumeContent()}, nil
	}
}

// UpdateMaster — rename, replace content, and/or set or clear the default.
func UpdateMaster(
	ctx context.Context, deps *ResumeDeps, in *UpdateMasterInput,
) (jobsmodel.ResumeMaster, error) {
	name, err := optionalName(in.Name)
	if err != nil {
		return jobsmodel.ResumeMaster{}, err
	}
	m, err := deps.Masters.Update(ctx, &MasterPatch{
		OwnerID: in.OwnerID, MasterID: in.MasterID, Name: name, Content: in.Content,
	})
	if err != nil {
		return m, fmt.Errorf("update master: %w", err)
	}
	return applyDefault(ctx, deps, &m, in.IsDefault)
}

// DeleteMaster — idempotent; drafts based on it stop naming it.
func DeleteMaster(ctx context.Context, deps *ResumeDeps, ownerID, id string) error {
	if err := deps.Masters.Delete(ctx, ownerID, id); err != nil {
		return fmt.Errorf("delete master: %w", err)
	}
	return nil
}

// TrashedMasters — the owner's masters in the trash.
func TrashedMasters(
	ctx context.Context, deps *ResumeDeps, ownerID string,
) ([]jobsmodel.TrashedMaster, error) {
	return deps.Masters.Trash(ctx, ownerID)
}

// RestoreMaster — takes a master out of the trash; it comes back as a plain (non-default) master.
func RestoreMaster(ctx context.Context, deps *ResumeDeps, ownerID, id string) error {
	return deps.Masters.Restore(ctx, ownerID, id)
}

// MasterTrashPurge — the daily purge of masters trashed longer than MasterTrashRetention.
func MasterTrashPurge(masters *ResumeMasterRepo) func(ctx context.Context) error {
	return func(ctx context.Context) error {
		return masters.Purge(ctx, time.Now().UTC().Add(-jobsmodel.MasterTrashRetention))
	}
}

// SaveDraftAsMaster — copy a draft's content into a master: overwrite MasterID, or create one
// called Name. The draft itself is unchanged.
func SaveDraftAsMaster(
	ctx context.Context, deps *ResumeDeps, in *SaveAsMasterInput,
) (jobsmodel.ResumeMaster, error) {
	if in.MasterID == "" {
		return CreateMaster(ctx, deps, &CreateMasterInput{
			OwnerID: in.OwnerID, Name: in.Name, DraftID: in.DraftID, IsDefault: in.MakeDefault,
		})
	}
	draft, err := deps.Drafts.GetByID(ctx, in.OwnerID, in.DraftID)
	if err != nil {
		return jobsmodel.ResumeMaster{}, fmt.Errorf("save as master: %w", err)
	}
	company := draft.JobSnapshot.Company
	m, err := deps.Masters.Update(ctx, &MasterPatch{
		OwnerID: in.OwnerID, MasterID: in.MasterID,
		Content: &draft.ResumeContent, FromCompany: &company,
	})
	if err != nil {
		return m, fmt.Errorf("overwrite master: %w", err)
	}
	return applyDefault(ctx, deps, &m, &in.MakeDefault)
}

// masterStart — a new draft's content from a master: the named one, else the default one, else
// blank (no default is not an error).
func masterStart(
	ctx context.Context, deps *ResumeDeps, ownerID, masterID string,
) (masterSeed, error) {
	m, err := pickMaster(ctx, deps, ownerID, masterID)
	if masterID == "" && errors.Is(err, jobsmodel.ErrResumeMasterNotFound) {
		return masterSeed{Content: blankResumeContent()}, nil
	}
	if err != nil {
		return masterSeed{}, fmt.Errorf("start from master: %w", err)
	}
	return masterSeed{Content: m.ResumeContent, MasterID: m.ID}, nil
}

func pickMaster(
	ctx context.Context, deps *ResumeDeps, ownerID, masterID string,
) (jobsmodel.ResumeMaster, error) {
	if masterID == "" {
		return deps.Masters.GetDefault(ctx, ownerID)
	}
	return deps.Masters.Get(ctx, ownerID, masterID)
}

// applyDefault — want nil leaves the default alone; true makes m the default; false clears it.
func applyDefault(
	ctx context.Context, deps *ResumeDeps, m *jobsmodel.ResumeMaster, want *bool,
) (jobsmodel.ResumeMaster, error) {
	if want == nil {
		return *m, nil
	}
	set := deps.Masters.ClearDefault
	if *want {
		set = deps.Masters.SetDefault
	}
	if err := set(ctx, m.OwnerID, m.ID); err != nil {
		return *m, fmt.Errorf("default master: %w", err)
	}
	m.IsDefault = *want
	return *m, nil
}

// optionalName — a rename's name, trimmed; nil = no rename; blank is refused.
func optionalName(s *string) (*string, error) {
	if s == nil {
		return nil, nil
	}
	t := strings.TrimSpace(*s)
	if t == "" {
		return nil, jobsmodel.ErrResumeMasterNameRequired
	}
	return &t, nil
}

// blankResumeContent — empty content with initialized slices: a nil slice marshals to JSON null,
// and the reader's schema takes an array (default([]) fills undefined, not null), so nil would
// fail the parse and the card would never render.
func blankResumeContent() jobsmodel.ResumeContent {
	return jobsmodel.ResumeContent{
		Works:      []jobsmodel.ResumeWork{},
		Educations: []jobsmodel.ResumeEducation{},
		Skills:     []jobsmodel.ResumeSkillSet{},
	}
}
