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

package fetch

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/textcut"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
)

const (
	hnDefaultBase    = "https://hacker-news.firebaseio.com"
	hnMaxComments    = 100
	hnTitlePrefix    = "Ask HN: Who is hiring"
	hnSubmittedDepth = 12
	hnTitleMaxLen    = 120
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
	ctx context.Context, cfgRaw []byte,
) ([]jobsmodel.FetchedJob, error) {
	acc, err := f.FetchAccounted(ctx, cfgRaw)
	if err != nil {
		return nil, err
	}
	return acc.Jobs, nil
}

// FetchAccounted —— 逐条取的那条路**必须交代自己跳过了什么**（Accountant）。
// 一帖 262 条评论、我们只读前 100 条、其中 2 条被删 —— 这三个数字放在一起，
// 「今天没人招」「被限流了」「判定条件写错了」才分得开（F-E-19）。
func (f *hnHiringFetcher) FetchAccounted(
	ctx context.Context, _ []byte,
) (Accounted, error) {
	threadID, err := f.findLatestHiringThread(ctx)
	if err != nil {
		return Accounted{}, err
	}
	thread, err := f.fetchItem(ctx, threadID)
	if err != nil {
		return Accounted{}, err
	}
	return f.collectComments(ctx, thread, threadID), nil
}

// collectComments —— 逐条取顶层评论。**每一次跳过都要数，而且要按原因数**。
//
// 这里原来是 `if ferr != nil || !isPostingComment(comment) { continue }` —— 一次**取数失败**
// 和一条**被删的评论**走同一条 `continue`，不计数也不记日志。于是「今天真没人招」
// 「firebase 把我们限流了」「判定条件写错了」三件事产出完全相同的回执：一个数字。
// 真实环境里就是这样：8 月那帖 262 条顶层评论，池子里进了 **1** 条，而没有任何一处
// 说得出另外那些去哪了（F-E-19）。数出来、记下来，就不必推理。
func (f *hnHiringFetcher) collectComments(
	ctx context.Context, thread *hnItem, threadID int64,
) Accounted {
	limit := min(len(thread.Kids), hnMaxComments)
	out := make([]jobsmodel.FetchedJob, 0, limit)
	failed, dropped := 0, 0
	for i := range limit {
		comment, ferr := f.fetchItem(ctx, thread.Kids[i])
		if ferr != nil {
			failed++
			continue
		}
		if !isPostingComment(comment) {
			dropped++
			continue
		}
		out = append(out, hnCommentToDomain(comment, threadID))
	}
	slog.InfoContext(ctx, "hn hiring thread walked",
		"thread", threadID, "kids", len(thread.Kids), "read", limit,
		"kept", len(out), "fetch_failed", failed, "deleted_or_empty", dropped)
	return Accounted{
		Jobs: out, Available: len(thread.Kids), Read: limit,
		Skipped:   map[string]int{"fetch_failed": failed, "deleted_or_empty": dropped},
		Truncated: len(thread.Kids) > limit,
	}
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

func hnCommentToDomain(c *hnItem, _ int64) jobsmodel.FetchedJob {
	return jobsmodel.FetchedJob{
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
	// Cut by CHARACTER, not by byte: first[:hnTitleMaxLen] can split a multibyte rune and
	// yield invalid UTF-8. One implementation of that, in textcut.
	return textcut.RunesMark(first, hnTitleMaxLen)
}
