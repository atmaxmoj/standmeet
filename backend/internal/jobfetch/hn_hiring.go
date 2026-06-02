// hn_hiring.go —— HackerNews "Ask HN: Who is hiring?" 月度大帖。
//
// 数据源是 HN firebase REST：
//
//	GET {base}/v0/user/whoishiring.json    → {submitted: [int, ...]}
//	GET {base}/v0/item/{id}.json           → 单 item (item.kids 是 comment ids)
//
// 找最新月度帖：whoishiring.submitted 里第一条 title 以
// "Ask HN: Who is hiring" 开头的 story；再 walk kids 拿 top-level
// comments，每条 comment 就是一条 posting。
//
// 不解析 comment 内容结构（"Company | Title | Location | ..."）—— 当
// raw text 传给 agent 让 Claude 自己读，符合"adapter 不 reason"原则。
//
// No per-source config (HN aggregate is global).

package jobfetch

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/atmaxmoj/standmeet/internal/domain"
)

const (
	hnDefaultBase       = "https://hacker-news.firebaseio.com"
	hnMaxComments       = 100
	hnTitlePrefix       = "Ask HN: Who is hiring"
	hnSubmittedDepth    = 12
	hnTitleMaxLen       = 120
	hnTitleEllipsisRune = "…"
)

type hnHiringFetcher struct {
	client *http.Client
	base   string
}

func newHNHiringFetcher(client *http.Client, envBase string) *hnHiringFetcher {
	return &hnHiringFetcher{
		client: client,
		base:   firstOrDefault(envBase, hnDefaultBase),
	}
}

func (f *hnHiringFetcher) Fetch(
	ctx context.Context, _ []byte,
) ([]domain.FetchedJob, error) {
	threadID, err := f.findLatestHiringThread(ctx)
	if err != nil {
		return nil, err
	}
	thread, err := f.fetchItem(ctx, threadID)
	if err != nil {
		return nil, err
	}
	return f.collectComments(ctx, thread, threadID), nil
}

func (f *hnHiringFetcher) collectComments(
	ctx context.Context, thread *hnItem, threadID int64,
) []domain.FetchedJob {
	limit := min(len(thread.Kids), hnMaxComments)
	out := make([]domain.FetchedJob, 0, limit)
	for i := range limit {
		comment, ferr := f.fetchItem(ctx, thread.Kids[i])
		if ferr != nil || !isPostingComment(comment) {
			continue
		}
		out = append(out, hnCommentToDomain(comment, threadID))
	}
	return out
}

func isPostingComment(c *hnItem) bool {
	return c != nil && !c.Deleted && !c.Dead && c.Text != ""
}

func (f *hnHiringFetcher) findLatestHiringThread(ctx context.Context) (int64, error) {
	ids, err := f.fetchSubmittedIDs(ctx)
	if err != nil {
		return 0, err
	}
	id := f.firstHiringThreadID(ctx, ids)
	if id == 0 {
		return 0, fmt.Errorf("%w: no hiring thread in latest submissions", ErrUpstreamSchema)
	}
	return id, nil
}

func (f *hnHiringFetcher) fetchSubmittedIDs(ctx context.Context) ([]int64, error) {
	url := f.base + "/v0/user/whoishiring.json"
	body, err := getBody(ctx, f.client, url)
	if err != nil {
		return nil, err
	}
	var user hnUser
	if uerr := json.Unmarshal(body, &user); uerr != nil {
		return nil, fmt.Errorf("decode %s: %w: %w", url, ErrUpstreamSchema, uerr)
	}
	return user.Submitted, nil
}

func (f *hnHiringFetcher) firstHiringThreadID(ctx context.Context, ids []int64) int64 {
	limit := min(len(ids), hnSubmittedDepth)
	for i := range limit {
		item, ferr := f.fetchItem(ctx, ids[i])
		if ferr == nil && strings.HasPrefix(item.Title, hnTitlePrefix) {
			return item.ID
		}
	}
	return 0
}

func (f *hnHiringFetcher) fetchItem(ctx context.Context, id int64) (*hnItem, error) {
	url := fmt.Sprintf("%s/v0/item/%d.json", f.base, id)
	body, err := getBody(ctx, f.client, url)
	if err != nil {
		return nil, err
	}
	var item hnItem
	if uerr := json.Unmarshal(body, &item); uerr != nil {
		return nil, fmt.Errorf("decode %s: %w: %w", url, ErrUpstreamSchema, uerr)
	}
	return &item, nil
}

type hnUser struct {
	Submitted []int64 `json:"submitted"`
}

type hnItem struct {
	Title   string  `json:"title"`
	By      string  `json:"by"`
	Text    string  `json:"text"`
	Kids    []int64 `json:"kids"`
	ID      int64   `json:"id"`
	Time    int64   `json:"time"`
	Parent  int64   `json:"parent"`
	Deleted bool    `json:"deleted"`
	Dead    bool    `json:"dead"`
}

func hnCommentToDomain(c *hnItem, _ int64) domain.FetchedJob {
	return domain.FetchedJob{
		ExternalID:  strconv.FormatInt(c.ID, decimalRadix),
		Title:       hnFirstLine(c.Text),
		Company:     "(see body — HN free-form)",
		Location:    "",
		URL:         fmt.Sprintf("https://news.ycombinator.com/item?id=%d", c.ID),
		BodyText:    c.Text,
		Tags:        []string{"hn_hiring", c.By},
		PublishedAt: time.Unix(c.Time, 0),
		SourceKind:  KindHNHiring,
	}
}

// hnFirstLine returns the first text line truncated to hnTitleMaxLen runes,
// used as the comment's display title in the job list (Claude reads the full
// BodyText to extract structured fields).
func hnFirstLine(text string) string {
	first := text
	if i := strings.Index(text, "\n"); i > 0 {
		first = text[:i]
	}
	if len(first) > hnTitleMaxLen {
		first = first[:hnTitleMaxLen] + hnTitleEllipsisRune
	}
	return first
}
