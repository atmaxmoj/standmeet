// register_probe.go —— one read of a board when the owner registers it (job-loop roadmap 4.3.b):
// how many jobs it lists and three titles, so the owner sees it is the board they meant. A board
// that does not exist is refused at registration instead of failing every fetch after.

package jobsuc

import (
	"context"
	"errors"
	"fmt"
	"time"

	jobfetch "github.com/atmaxmoj/standmeet/internal/owner/jobs/fetch"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
)

// RegisteredSource —— the new source and what one read of its board found.
type RegisteredSource struct {
	Source jobsmodel.JobSource
	Probe  SourceProbe
}

// SourceProbe —— one read of the board at registration. Error is a sentence for a board that
// answered but not with jobs (busy, slow, a bad body); the source is still registered then.
type SourceProbe struct {
	Error        string   `json:"error,omitempty"`
	SampleTitles []string `json:"sample_titles"`
	Count        int      `json:"count"`
}

// probeTimeout / probeSamples —— how long registration waits for the board; how many titles it
// shows back.
const (
	probeTimeout = 15 * time.Second
	probeSamples = 3
)

// ErrNoSuchBoard —— registration found no board at the configured address.
var ErrNoSuchBoard = errors.New(
	"no such board at that address — check the company slug in the source's settings")

func probeSource(
	ctx context.Context, reg *jobfetch.Registry, in *jobsmodel.CreateJobSourceInput,
) (SourceProbe, error) {
	ctx, cancel := context.WithTimeout(ctx, probeTimeout)
	defer cancel()
	acc, err := reg.FetchAccounted(ctx, in.Kind, in.Config)
	if errors.Is(err, jobfetch.ErrUpstreamNoBoard) {
		return SourceProbe{}, fmt.Errorf("probe: %w", ErrNoSuchBoard)
	}
	if err != nil {
		return SourceProbe{SampleTitles: []string{}, Error: sourceFailureSentence(err)}, nil
	}
	titles := make([]string, 0, probeSamples)
	for i := 0; i < len(acc.Jobs) && len(titles) < probeSamples; i++ {
		titles = append(titles, acc.Jobs[i].Title)
	}
	return SourceProbe{Count: len(acc.Jobs), SampleTitles: titles}, nil
}
