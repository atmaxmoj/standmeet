// hn_hiring.go —— HackerNews "Ask HN: Who is hiring?" 月度大帖。
//
// 数据源是 HN firebase REST：
//   GET {base}/v0/user/whoishiring.json    → {submitted: [int, ...]}
//   GET {base}/v0/item/{id}.json           → 单 item (item.kids 是 comment ids)
//
// 找最新月度帖：whoishiring.submitted 里第一条 title 以
// "Ask HN: Who is hiring" 开头的 story；再 walk kids 拿 top-level
// comments，每条 comment 就是一条 posting。
//
// 不解析 comment 内容结构（"Company | Title | Location | ..."）—— 当
// raw text 传给 agent 让 Claude 自己读，符合"adapter 不 reason"原则。

package jobfetch

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/wangsijie/standmeet/internal/domain"
)

const (
	hnDefaultBase    = "https://hacker-news.firebaseio.com"
	hnMaxComments    = 100 // 一个月度帖通常 200-500 评论，先 cap 在 100；MVP 够
	hnTitlePrefix    = "Ask HN: Who is hiring"
	hnSubmittedDepth = 12 // 看 submitted 前 N 条找最新月度帖（每月一发，看 6-12 条够）
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
	ctx context.Context, _ map[string]any,
) ([]domain.FetchedJob, error) {
	threadID, err := f.findLatestHiringThread(ctx)
	if err != nil {
		return nil, err
	}
	thread, err := f.fetchItem(ctx, threadID)
	if err != nil {
		return nil, err
	}
	limit := len(thread.Kids)
	if limit > hnMaxComments {
		limit = hnMaxComments
	}
	out := make([]domain.FetchedJob, 0, limit)
	for i := 0; i < limit; i++ {
		comment, ferr := f.fetchItem(ctx, thread.Kids[i])
		if ferr != nil {
			continue // single bad comment 不 fail 整批
		}
		if comment.Deleted || comment.Dead || comment.Text == "" {
			continue
		}
		out = append(out, hnCommentToDomain(comment, threadID))
	}
	return out, nil
}

func (f *hnHiringFetcher) findLatestHiringThread(ctx context.Context) (int64, error) {
	url := f.base + "/v0/user/whoishiring.json"
	var user hnUser
	if err := getJSON(ctx, f.client, url, &user); err != nil {
		return 0, err
	}
	limit := len(user.Submitted)
	if limit > hnSubmittedDepth {
		limit = hnSubmittedDepth
	}
	for i := 0; i < limit; i++ {
		item, err := f.fetchItem(ctx, user.Submitted[i])
		if err != nil {
			continue
		}
		if strings.HasPrefix(item.Title, hnTitlePrefix) {
			return item.ID, nil
		}
	}
	return 0, fmt.Errorf("%w: no hiring thread in latest submissions", ErrUpstreamSchema)
}

func (f *hnHiringFetcher) fetchItem(ctx context.Context, id int64) (*hnItem, error) {
	url := fmt.Sprintf("%s/v0/item/%d.json", f.base, id)
	var item hnItem
	if err := getJSON(ctx, f.client, url, &item); err != nil {
		return nil, err
	}
	return &item, nil
}

type hnUser struct {
	Submitted []int64 `json:"submitted"`
}

type hnItem struct {
	ID      int64   `json:"id"`
	Title   string  `json:"title"`
	By      string  `json:"by"`
	Time    int64   `json:"time"` // epoch seconds
	Text    string  `json:"text"`
	Kids    []int64 `json:"kids"`
	Parent  int64   `json:"parent"`
	Deleted bool    `json:"deleted"`
	Dead    bool    `json:"dead"`
}

func hnCommentToDomain(c *hnItem, _ int64) domain.FetchedJob {
	// HN 月度帖 comment 习惯第一行是
	// "Company | Title | Location | Remote? | Full-time? | apply_url"
	// adapter 不强 parse；取第一行作 Title 帮 agent 快速判定。
	firstLine := c.Text
	if i := strings.Index(c.Text, "\n"); i > 0 {
		firstLine = c.Text[:i]
	}
	// title 截 120 char 避免污染列表 UI
	if len(firstLine) > 120 {
		firstLine = firstLine[:120] + "…"
	}
	return domain.FetchedJob{
		ExternalID:  strconv.FormatInt(c.ID, 10),
		Title:       firstLine,
		Company:     "(see body — HN free-form)",
		Location:    "",
		URL:         fmt.Sprintf("https://news.ycombinator.com/item?id=%d", c.ID),
		BodyText:    c.Text,
		Tags:        []string{"hn_hiring", c.By},
		PublishedAt: time.Unix(c.Time, 0),
		SourceKind:  KindHNHiring,
	}
}
