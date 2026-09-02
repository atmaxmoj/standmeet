// hn_hiring.go —— HackerNews's monthly "Ask HN: Who is hiring?" thread.
//
// The data source is the HN firebase REST API:
//
//	GET {base}/v0/user/whoishiring.json    → {submitted: [int, ...]}
//	GET {base}/v0/item/{id}.json           → a single item (item.kids is comment ids)
//
// Finding the latest monthly thread: the first story in
// whoishiring.submitted whose title starts with "Ask HN: Who is hiring";
// then walk its kids to get top-level comments, each comment being one
// posting.
//
// The comment's content structure ("Company | Title | Location | ...")
// isn't parsed — it's passed through as raw text for the agent, letting
// Claude read it itself, in line with the "adapters don't reason" principle.
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

// FetchAccounted —— the item-by-item fetch path **must account for what it
// skipped** (an Accountant). Given a thread with 262 comments where we only
// read the first 100 and 2 of those were deleted — only having all three
// numbers together lets you tell apart "nobody's hiring today", "we got
// rate-limited", and "the filter condition is wrong" (F-E-19).
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

// collectComments —— fetches top-level comments one by one. **Every skip
// must be counted, and counted by reason.**
//
// This used to be `if ferr != nil || !isPostingComment(comment) { continue }`
// — a **fetch failure** and a **deleted comment** went through the same
// `continue`, with no counting and no logging. So "nobody's really hiring
// today", "firebase rate-limited us", and "the filter condition is wrong"
// all produced the exact same receipt: a single number. This is exactly
// what happened in the real environment: an August thread had 262 top-level
// comments, and only **1** made it into the pool, with nothing anywhere
// able to say where the rest went (F-E-19). Count them and log them, and
// you don't have to guess.
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
