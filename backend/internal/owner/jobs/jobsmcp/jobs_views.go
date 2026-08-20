// jobs_views.go —— jobs.* tool 响应的 JSON 形状。

package jobsmcp

import (
	"encoding/json"
	"time"

	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsuc"
)

type jobSourceViewT struct {
	LastFetchedAt *string `json:"last_fetched_at,omitempty"`
	// LastAttemptedAt / LastError —— 上一次**试过**是什么时候、结果如何。
	// 只报 last_fetched_at 的话，「每次都失败」跟「从没试过」是同一个空缺（F-E-18）。
	LastAttemptedAt *string         `json:"last_attempted_at,omitempty"`
	LastError       string          `json:"last_error,omitempty"`
	ID              string          `json:"id"`
	Kind            string          `json:"kind"`
	Label           string          `json:"label"`
	CreatedAt       string          `json:"created_at"`
	Config          json.RawMessage `json:"config"`
}

type fetchedJobView struct {
	PublishedAt string   `json:"published_at,omitempty"`
	CacheID     string   `json:"cache_id"`
	SourceID    string   `json:"source_id"`
	SourceKind  string   `json:"source_kind"`
	ExternalID  string   `json:"external_id"`
	Title       string   `json:"title"`
	Company     string   `json:"company"`
	Location    string   `json:"location"`
	URL         string   `json:"url"`
	BodyText    string   `json:"body_text,omitempty"`
	Tags        []string `json:"tags"`
}

func jobSourceView(s *jobsmodel.JobSource) jobSourceViewT {
	cfg := json.RawMessage(s.Config)
	if len(cfg) == 0 {
		cfg = json.RawMessage(`{}`)
	}
	v := jobSourceViewT{
		ID:        s.ID,
		Kind:      s.Kind,
		Label:     s.Label,
		Config:    cfg,
		CreatedAt: s.CreatedAt.Format(mcpTimeFmt),
	}
	if s.LastFetchedAt != nil {
		t := s.LastFetchedAt.Format(mcpTimeFmt)
		v.LastFetchedAt = &t
	}
	if s.LastAttemptedAt != nil {
		t := s.LastAttemptedAt.Format(mcpTimeFmt)
		v.LastAttemptedAt = &t
	}
	v.LastError = s.LastError
	return v
}

// poolRowView —— 列表里的一行。**没有 body_text**：那是 `jobs.show` 的活。
//
// 一次取数今天会捞回两三百条真岗位，每条正文一两千字。把它们全塞进回执，owner
// 那一侧的 AI 光是收下这一个工具结果就把上下文用光了，而排序只需要标题、公司、
// 地点、标签 —— 人扫招聘板看的也正是这几样。挑中的那几条再 `jobs.show` 读全文。
type poolRowView struct {
	PublishedAt string   `json:"published_at,omitempty"`
	CacheID     string   `json:"cache_id"`
	SourceID    string   `json:"source_id"`
	SourceKind  string   `json:"source_kind"`
	ExternalID  string   `json:"external_id"`
	Title       string   `json:"title"`
	Company     string   `json:"company"`
	Location    string   `json:"location"`
	URL         string   `json:"url"`
	Tags        []string `json:"tags"`
	// TTLRemainingSeconds —— 这条还能在池子里活多久。设计里 fetch_new 的回执一直
	// 写着 ttl_remaining，实现漏了；没有它，owner 那一侧无从知道"这条今天还来得及吗"。
	TTLRemainingSeconds int `json:"ttl_remaining_seconds"`
	// New —— 这一趟才进池子的。区分"今天的板子长这样"和"跟你上次看比多了这几条"。
	New bool `json:"new"`
}

func poolRowViews(rows []jobsuc.PoolRow) []poolRowView {
	out := make([]poolRowView, 0, len(rows))
	for i := range rows {
		out = append(out, poolRowToView(&rows[i]))
	}
	return out
}

func poolRowToView(r *jobsuc.PoolRow) poolRowView {
	v := poolRowView{
		CacheID:             r.Job.CacheID,
		SourceID:            r.Job.SourceID,
		SourceKind:          r.Job.SourceKind,
		ExternalID:          r.Job.ExternalID,
		Title:               r.Job.Title,
		Company:             r.Job.Company,
		Location:            r.Job.Location,
		URL:                 r.Job.URL,
		Tags:                r.Job.Tags,
		TTLRemainingSeconds: int(r.TTLRemaining / time.Second),
		New:                 r.New,
	}
	if !r.Job.PublishedAt.IsZero() {
		v.PublishedAt = r.Job.PublishedAt.Format(time.RFC3339)
	}
	return v
}

func fetchedJobToView(j *jobsmodel.FetchedJob) fetchedJobView {
	v := fetchedJobView{
		CacheID:    j.CacheID,
		SourceID:   j.SourceID,
		SourceKind: j.SourceKind,
		ExternalID: j.ExternalID,
		Title:      j.Title,
		Company:    j.Company,
		Location:   j.Location,
		URL:        j.URL,
		BodyText:   j.BodyText,
		Tags:       j.Tags,
	}
	if !j.PublishedAt.IsZero() {
		v.PublishedAt = j.PublishedAt.Format(time.RFC3339)
	}
	return v
}
