// applications_commit_test.go —— #13: the final PDF is rendered BEFORE the irreversible commit, so
// render failure persists nothing (retryable) instead of stranding a committed application (code
// issued, draft deleted) with no PDF and no recovery path.

package jobsuc_test

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/atmaxmoj/standmeet/internal/owner"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsuc"
)

type spyCommitStore struct{ committed bool }

func (*spyCommitStore) GetDraftRenderData(
	_ context.Context, _, _ string,
) (jobsuc.DraftRenderData, error) {
	return jobsuc.DraftRenderData{}, nil
}

func (s *spyCommitStore) Commit(
	_ context.Context, _ *jobsuc.CommitInput,
) (jobsuc.CommitOutput, error) {
	s.committed = true
	return jobsuc.CommitOutput{}, nil
}

type fakeOwnerLookup struct{ url string }

func (f fakeOwnerLookup) GetByID(_ context.Context, _ string) (owner.Owner, error) {
	return owner.Owner{PublicURL: f.url}, nil
}

type failingRenderer struct{}

func (failingRenderer) RenderApplicationPDF(
	_ context.Context, _ *jobsmodel.Application, _ string,
) ([]byte, error) {
	return nil, errors.New("render boom")
}

func TestCommitApplicationRendersBeforePersist(t *testing.T) {
	t.Parallel()
	store := &spyCommitStore{}
	deps := jobsuc.ApplicationsDeps{
		Apps:     store,
		Owners:   fakeOwnerLookup{url: "https://alice.example"},
		Renderer: failingRenderer{},
	}
	_, err := jobsuc.CommitApplication(context.Background(), deps, "owner-1", "draft-1")
	require.Error(t, err, "a render failure must surface")
	require.False(t, store.committed,
		"render failure must NOT persist the application — commit stays retryable")
}
