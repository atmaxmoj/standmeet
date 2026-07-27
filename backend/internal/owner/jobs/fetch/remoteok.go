// remoteok.go — RemoteOK aggregate JSON.
//
//	GET {base}/api
//
// Returns a heterogeneous array: index 0 is the legal/attribution
// notice (no id), the rest are jobs. We unmarshal into a tagged struct
// and skip entries that fail the "has id + position" sanity check.
//
// Config is empty (no per-source parameters); register_source just needs
// kind=remoteok + a label.

package fetch

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
)

const remoteOKDefaultBase = "https://remoteok.com"

type remoteOKFetcher struct {
	client *http.Client
	base   string
}

func newRemoteOKFetcher(client *http.Client, envBase string) *remoteOKFetcher {
	return &remoteOKFetcher{
		client: client,
		base:   firstOrDefault(envBase, remoteOKDefaultBase),
	}
}

func (f *remoteOKFetcher) Fetch(
	ctx context.Context, _ []byte,
) ([]jobsmodel.FetchedJob, error) {
	raw, err := f.fetchEntries(ctx)
	if err != nil {
		return nil, err
	}
	return filterRemoteOKEntries(raw), nil
}

func (f *remoteOKFetcher) fetchEntries(ctx context.Context) ([]remoteOKEntry, error) {
	url := f.base + "/api"
	body, err := getBody(ctx, f.client, url)
	if err != nil {
		return nil, err
	}
	var raw []remoteOKEntry
	if uerr := json.Unmarshal(body, &raw); uerr != nil {
		return nil, fmt.Errorf("decode %s: %w: %w", url, ErrUpstreamSchema, uerr)
	}
	return raw, nil
}

func filterRemoteOKEntries(raw []remoteOKEntry) []jobsmodel.FetchedJob {
	out := make([]jobsmodel.FetchedJob, 0, len(raw))
	for i := range raw {
		if raw[i].ID == "" || raw[i].Position == "" {
			continue // legal-notice element / malformed entry
		}
		out = append(out, remoteOKToDomain(&raw[i]))
	}
	return out
}

// remoteOKEntry — RemoteOK /api array element. Decoders ignore the legal-
// notice object cleanly because its keys (legal/disclaimer) don't match.
type remoteOKEntry struct {
	ID          string   `json:"id"`
	Position    string   `json:"position"`
	Company     string   `json:"company"`
	Location    string   `json:"location"`
	ApplyURL    string   `json:"apply_url"`
	URL         string   `json:"url"`
	Description string   `json:"description"`
	Tags        []string `json:"tags"`
	Epoch       int64    `json:"epoch"`
}

func remoteOKToDomain(e *remoteOKEntry) jobsmodel.FetchedJob {
	applyURL := e.ApplyURL
	if applyURL == "" {
		applyURL = e.URL
	}
	var published time.Time
	if e.Epoch > 0 {
		published = time.Unix(e.Epoch, 0)
	}
	return jobsmodel.FetchedJob{
		ExternalID:  e.ID,
		Title:       e.Position,
		Company:     e.Company,
		Location:    e.Location,
		URL:         applyURL,
		BodyText:    e.Description,
		Tags:        append([]string{}, e.Tags...),
		PublishedAt: published,
		SourceKind:  KindRemoteOK,
	}
}
