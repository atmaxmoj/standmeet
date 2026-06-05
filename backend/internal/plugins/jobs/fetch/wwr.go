// wwr.go —— WeWorkRemotely category RSS。
//
//	GET {base}/categories/{slug}.rss
//
// 多 category 时一个 source 配 ["cat1", "cat2"]，fetcher 串行 GET 多个 RSS
// 合并去重（按 guid）。
//
// item shape (custom RSS extensions)：
//
//	title              "Acme: Senior Engineer"
//	region             "Anywhere in the World"
//	country / state
//	skills             逗号 free-text
//	category           "Back-End Programming"
//	type               "Full-Time"
//	description        HTML (already entity-encoded once)
//	pubDate            RFC-822
//	guid / link        per-job URL (相同)

package fetch

import (
	"context"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/atmaxmoj/standmeet/internal/domain"
)

const wwrDefaultBase = "https://weworkremotely.com"

type wwrConfig struct {
	Categories []string `json:"categories"`
}

type wwrFetcher struct {
	client *http.Client
	base   string
}

func newWWRFetcher(client *http.Client, envBase string) *wwrFetcher {
	return &wwrFetcher{
		client: client,
		base:   firstOrDefault(envBase, wwrDefaultBase),
	}
}

func (f *wwrFetcher) Fetch(
	ctx context.Context, cfgRaw []byte,
) ([]domain.FetchedJob, error) {
	cfg, err := parseWWRConfig(cfgRaw)
	if err != nil {
		return nil, err
	}
	return f.fetchAllCategories(ctx, nonEmptyCategories(cfg.Categories))
}

func parseWWRConfig(raw []byte) (wwrConfig, error) {
	var cfg wwrConfig
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &cfg); err != nil {
			return cfg, fmt.Errorf("wwr config decode: %w: %w",
				domain.ErrJobSourceConfigInvalid, err)
		}
	}
	if len(nonEmptyCategories(cfg.Categories)) == 0 {
		return cfg, fmt.Errorf("wwr requires non-empty categories: %w",
			domain.ErrJobSourceConfigInvalid)
	}
	return cfg, nil
}

func (f *wwrFetcher) fetchAllCategories(
	ctx context.Context, cats []string,
) ([]domain.FetchedJob, error) {
	seen := make(map[string]struct{}, len(cats)*16)
	all := make([]domain.FetchedJob, 0, len(cats)*16)
	for _, cat := range cats {
		jobs, ferr := f.fetchCategory(ctx, cat)
		if ferr != nil {
			return nil, ferr
		}
		all = mergeDedupedByExternalID(all, jobs, seen)
	}
	return all, nil
}

func mergeDedupedByExternalID(
	all, incoming []domain.FetchedJob, seen map[string]struct{},
) []domain.FetchedJob {
	for i := range incoming {
		if _, dup := seen[incoming[i].ExternalID]; dup {
			continue
		}
		seen[incoming[i].ExternalID] = struct{}{}
		all = append(all, incoming[i])
	}
	return all
}

func validateWWRCfg(raw []byte) error {
	_, err := parseWWRConfig(raw)
	return err
}

func nonEmptyCategories(in []string) []string {
	out := make([]string, 0, len(in))
	for _, c := range in {
		if c != "" {
			out = append(out, c)
		}
	}
	return out
}

func (f *wwrFetcher) fetchCategory(
	ctx context.Context, slug string,
) ([]domain.FetchedJob, error) {
	url := fmt.Sprintf("%s/categories/%s.rss", f.base, slug)
	body, err := getBody(ctx, f.client, url)
	if err != nil {
		return nil, err
	}
	var feed wwrFeed
	if uerr := xml.Unmarshal(body, &feed); uerr != nil {
		return nil, fmt.Errorf("decode rss %s: %w: %w", url, ErrUpstreamSchema, uerr)
	}
	out := make([]domain.FetchedJob, 0, len(feed.Channel.Items))
	for i := range feed.Channel.Items {
		out = append(out, wwrToDomain(&feed.Channel.Items[i]))
	}
	return out, nil
}

type wwrFeed struct {
	XMLName xml.Name   `xml:"rss"`
	Channel wwrChannel `xml:"channel"`
}

type wwrChannel struct {
	Items []wwrItem `xml:"item"`
}

type wwrItem struct {
	Title       string `xml:"title"`
	Region      string `xml:"region"`
	Country     string `xml:"country"`
	State       string `xml:"state"`
	Skills      string `xml:"skills"`
	Category    string `xml:"category"`
	Type        string `xml:"type"`
	Description string `xml:"description"`
	PubDate     string `xml:"pubDate"`
	GUID        string `xml:"guid"`
	Link        string `xml:"link"`
}

func wwrToDomain(it *wwrItem) domain.FetchedJob {
	tc := splitWWRTitle(it.Title)
	url := it.Link
	if url == "" {
		url = it.GUID
	}
	return domain.FetchedJob{
		ExternalID:  it.GUID,
		Title:       tc.title,
		Company:     tc.company,
		Location:    firstNonEmpty(it.Region, it.Country, it.State),
		URL:         url,
		BodyText:    it.Description,
		Tags:        wwrTags(it),
		PublishedAt: parseRFC822Time(it.PubDate),
		SourceKind:  KindWWR,
	}
}

func wwrTags(it *wwrItem) []string {
	tags := make([]string, 0, defaultTagCap)
	tags = appendIfNonEmpty(tags, it.Category)
	tags = appendIfNonEmpty(tags, it.Type)
	if it.Skills != "" {
		for s := range strings.SplitSeq(it.Skills, ",") {
			tags = appendIfNonEmpty(tags, strings.TrimSpace(s))
		}
	}
	return tags
}

// titleCompany pairs the two parts split from a WWR <title> string.
type titleCompany struct {
	title   string
	company string
}

// splitWWRTitle —— WWR 习惯把 "Company: Job Title" 塞 <title> 里。
// 没冒号就把整 string 当 title，company 空。
func splitWWRTitle(t string) titleCompany {
	parts := strings.SplitN(t, ":", 2)
	const wwrTitleParts = 2
	if len(parts) == wwrTitleParts {
		return titleCompany{
			title:   strings.TrimSpace(parts[1]),
			company: strings.TrimSpace(parts[0]),
		}
	}
	return titleCompany{title: strings.TrimSpace(t)}
}

func parseRFC822Time(s string) time.Time {
	if s == "" {
		return time.Time{}
	}
	// RFC1123Z 是 Go 库里 "Mon, 02 Jan 2006 15:04:05 -0700" 的格式 —— RSS pubDate 用这个
	t, err := time.Parse(time.RFC1123Z, s)
	if err != nil {
		return time.Time{}
	}
	return t
}
