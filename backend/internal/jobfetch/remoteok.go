// remoteok.go — RemoteOK aggregate JSON.
//
//	GET {base}/api
//
// Returns a heterogeneous array: index 0 is the legal/attribution
// notice (no id), the rest are jobs. We unmarshal into a tagged struct
// and skip entries that fail the "has id + position" sanity check.
//
// ToS asks for attribution to RemoteOK on rendered output. Our usage
// keeps results private to the owner (not shown to visitors), so the
// attribution constraint lives in the source-registration UI copy.

package jobfetch

import (
	"context"
	"net/http"
	"time"

	"github.com/wangsijie/standmeet/internal/domain"
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
	ctx context.Context, _ map[string]any,
) ([]domain.FetchedJob, error) {
	url := f.base + "/api"
	var raw []remoteOKEntry
	if err := getJSON(ctx, f.client, url, &raw); err != nil {
		return nil, err
	}
	out := make([]domain.FetchedJob, 0, len(raw))
	for i := range raw {
		if raw[i].ID == "" || raw[i].Position == "" {
			continue // legal-notice element / malformed entry
		}
		out = append(out, remoteOKToDomain(&raw[i]))
	}
	return out, nil
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

func remoteOKToDomain(e *remoteOKEntry) domain.FetchedJob {
	applyURL := e.ApplyURL
	if applyURL == "" {
		applyURL = e.URL
	}
	var published time.Time
	if e.Epoch > 0 {
		published = time.Unix(e.Epoch, 0)
	}
	return domain.FetchedJob{
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
