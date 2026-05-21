// workable.go —— Workable widget API (v1.1, real jobs endpoint TBD).
//
// Capture showed the widget endpoint returns account metadata (name +
// description), not jobs:
//
//	GET {base}/api/v1/widget/accounts/{sub}  → {name, description}
//
// Real jobs listing needs a different endpoint (Workable docs mention
// /api/jobs/spi but it requires auth). This adapter is a stub: Fetch
// always errors out so register_source for kind=workable surfaces the
// problem instead of silently returning empty.

package jobfetch

import (
	"context"
	"errors"
	"net/http"

	"github.com/wangsijie/standmeet/internal/domain"
)

const workableDefaultBase = "https://apply.workable.com"

type workableFetcher struct {
	client *http.Client
	base   string
}

func newWorkableFetcher(client *http.Client, envBase string) *workableFetcher {
	return &workableFetcher{
		client: client,
		base:   firstOrDefault(envBase, workableDefaultBase),
	}
}

// Fetch — v1 stub. Returns ErrUpstreamSchema until v1.1 wires the real
// jobs endpoint. Receiver kept (not blanked) for future use.
func (f *workableFetcher) Fetch(
	_ context.Context, _ map[string]any,
) ([]domain.FetchedJob, error) {
	_ = f.base
	_ = f.client
	return nil, errors.New(
		"workable adapter is a v1.1 stub: widget endpoint returns metadata only, " +
			"jobs endpoint pending",
	)
}
