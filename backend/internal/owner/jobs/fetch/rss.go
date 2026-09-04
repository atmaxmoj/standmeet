// rss.go — a GENERIC RSS 2.0 job-feed adapter. Config: {"feed_url": "..."}.
//
// The long tail of niche job boards (by stack, region, industry) each expose a standard RSS feed.
// One adapter covers them ALL: a board becomes a seeded source pointing feed_url at its feed, no
// bespoke code per board. Same generic-URL shape as jobposting_jsonld (which reads any site's
// schema.org JobPosting). Company is taken from <dc:creator> when the feed carries it; the title is
// left WHOLE — splitting "Company: Title" is board-specific and wrong as often as right, and
// structure-parsing stays Claude's job (job-loop.md L.1), not the adapter's.

package fetch

import (
	"context"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
)

type rssConfig struct {
	FeedURL string `json:"feed_url"`
}

type rssFetcher struct {
	client *http.Client
}

// newRSSFetcher — no base URL: the feed URL IS the config (each niche board is one seeded source).
func newRSSFetcher(client *http.Client) *rssFetcher {
	return &rssFetcher{client: client}
}

func (f *rssFetcher) Fetch(ctx context.Context, cfgRaw []byte) ([]jobsmodel.FetchedJob, error) {
	cfg, err := parseRSSConfig(cfgRaw)
	if err != nil {
		return nil, err
	}
	body, err := getBody(ctx, f.client, cfg.FeedURL)
	if err != nil {
		return nil, err
	}
	var feed rssFeed
	if uerr := xml.Unmarshal(body, &feed); uerr != nil {
		return nil, fmt.Errorf("decode rss %s: %w: %w", cfg.FeedURL, ErrUpstreamSchema, uerr)
	}
	out := make([]jobsmodel.FetchedJob, 0, len(feed.Channel.Items))
	for i := range feed.Channel.Items {
		out = append(out, rssItemToDomain(&feed.Channel.Items[i]))
	}
	return out, nil
}

func parseRSSConfig(raw []byte) (rssConfig, error) {
	var cfg rssConfig
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &cfg); err != nil {
			return cfg, fmt.Errorf("rss config decode: %w: %w",
				jobsmodel.ErrJobSourceConfigInvalid, err)
		}
	}
	cfg.FeedURL = strings.TrimSpace(cfg.FeedURL)
	if !isHTTPURL(cfg.FeedURL) {
		return cfg, fmt.Errorf("rss requires an http(s) feed_url: %w",
			jobsmodel.ErrJobSourceConfigInvalid)
	}
	return cfg, nil
}

func isHTTPURL(s string) bool {
	if s == "" {
		return false
	}
	u, err := url.Parse(s)
	return err == nil && (u.Scheme == "http" || u.Scheme == "https")
}

func validateRSSCfg(raw []byte) error {
	_, err := parseRSSConfig(raw)
	return err
}

type rssFeed struct {
	XMLName xml.Name   `xml:"rss"`
	Channel rssChannel `xml:"channel"`
}

type rssChannel struct {
	Items []rssItem `xml:"item"`
}

type rssItem struct {
	Title       string   `xml:"title"`
	Link        string   `xml:"link"`
	Description string   `xml:"description"`
	GUID        string   `xml:"guid"`
	PubDate     string   `xml:"pubDate"`
	Creator     string   `xml:"creator"` // dc:creator — encoding/xml matches on the local name
	Categories  []string `xml:"category"`
}

func rssItemToDomain(it *rssItem) jobsmodel.FetchedJob {
	link := it.Link
	if link == "" {
		link = it.GUID
	}
	extID := it.GUID
	if extID == "" {
		extID = link
	}
	return jobsmodel.FetchedJob{
		ExternalID:  extID,
		Title:       strings.TrimSpace(it.Title),
		Company:     strings.TrimSpace(it.Creator),
		URL:         link,
		BodyText:    it.Description,
		Tags:        rssTags(it.Categories),
		PublishedAt: parseRFC822Time(it.PubDate),
		SourceKind:  KindRSS,
	}
}

func rssTags(cats []string) []string {
	tags := make([]string, 0, defaultTagCap)
	for _, c := range cats {
		tags = appendIfNonEmpty(tags, strings.TrimSpace(c))
	}
	return tags
}
