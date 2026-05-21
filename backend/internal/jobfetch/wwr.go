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

package jobfetch

import (
	"context"
	"encoding/xml"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/wangsijie/standmeet/internal/domain"
)

const wwrDefaultBase = "https://weworkremotely.com"

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
	ctx context.Context, cfg map[string]any,
) ([]domain.FetchedJob, error) {
	cats, err := extractWWRCategories(cfg)
	if err != nil {
		return nil, err
	}
	seen := make(map[string]struct{}, 32)
	all := make([]domain.FetchedJob, 0, 32)
	for _, cat := range cats {
		jobs, ferr := f.fetchCategory(ctx, cat)
		if ferr != nil {
			return nil, ferr
		}
		for i := range jobs {
			if _, dup := seen[jobs[i].ExternalID]; dup {
				continue
			}
			seen[jobs[i].ExternalID] = struct{}{}
			all = append(all, jobs[i])
		}
	}
	return all, nil
}

func extractWWRCategories(cfg map[string]any) ([]string, error) {
	raw, ok := cfg["categories"]
	if !ok {
		return nil, fmt.Errorf("wwr missing categories: %w", domain.ErrJobSourceConfigInvalid)
	}
	arr, ok := raw.([]any)
	if !ok {
		return nil, fmt.Errorf("wwr categories not array: %w", domain.ErrJobSourceConfigInvalid)
	}
	out := make([]string, 0, len(arr))
	for _, v := range arr {
		s, sok := v.(string)
		if !sok || s == "" {
			continue
		}
		out = append(out, s)
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("wwr categories empty: %w", domain.ErrJobSourceConfigInvalid)
	}
	return out, nil
}

func (f *wwrFetcher) fetchCategory(
	ctx context.Context, slug string,
) ([]domain.FetchedJob, error) {
	url := fmt.Sprintf("%s/categories/%s.rss", f.base, slug)
	var feed wwrFeed
	if err := getXML(ctx, f.client, url, &feed); err != nil {
		return nil, err
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
	title, company := tc.title, tc.company
	tags := make([]string, 0, 4)
	if it.Category != "" {
		tags = append(tags, it.Category)
	}
	if it.Type != "" {
		tags = append(tags, it.Type)
	}
	if it.Skills != "" {
		for s := range strings.SplitSeq(it.Skills, ",") {
			s = strings.TrimSpace(s)
			if s != "" {
				tags = append(tags, s)
			}
		}
	}
	url := it.Link
	if url == "" {
		url = it.GUID
	}
	return domain.FetchedJob{
		ExternalID:  it.GUID,
		Title:       title,
		Company:     company,
		Location:    firstNonEmpty(it.Region, it.Country, it.State),
		URL:         url,
		BodyText:    it.Description,
		Tags:        tags,
		PublishedAt: parseRFC822Time(it.PubDate),
		SourceKind:  KindWWR,
	}
}

// titleCompany pairs the two parts split from a WWR <title> string.
// Named struct fields avoid confusing-results / nonamedreturns conflict.
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

func firstNonEmpty(ss ...string) string {
	for _, s := range ss {
		if s != "" {
			return s
		}
	}
	return ""
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
