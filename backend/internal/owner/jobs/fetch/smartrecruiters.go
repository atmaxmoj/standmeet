// smartrecruiters.go —— SmartRecruiters posting API (v1.1 source).
//
//	GET {base}/v1/companies/{company}/postings?limit=200
//
// 响应 {offset, limit, totalFound, content: [...]}。每条 posting 有
// id / name / refNumber / location.{country,region,city,remote}
// / department.label / releasedDate / industry.label / typeOfEmployment.label
// / experienceLevel.label。

package fetch

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"

	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
)

const (
	smartRecruitersDefaultBase = "https://api.smartrecruiters.com"
	// smartRecruitersPageLimit —— **厂商的每页上限**。量出来的：2026-08-16 请求 `?limit=200`，
	// 响应体里回的是 `"limit":100` —— 它悄悄压到 100，既不报错也不说自己压过。
	// 这里原来就是写 200 请求一次收工，于是超过 100 个岗位的公司**静默只取前 100 条**（F-E-16）。
	smartRecruitersPageLimit = 100
	// smartRecruitersMaxPages —— 翻页硬上限；撞到就把「结果是部分的」记下来，不让截断悄悄发生。
	smartRecruitersMaxPages = 20
)

type smartRecruitersConfig struct {
	Company string `json:"company"`
}

type smartRecruitersFetcher struct {
	client *http.Client
	base   string
}

func newSmartRecruitersFetcher(client *http.Client, envBase string) *smartRecruitersFetcher {
	return &smartRecruitersFetcher{
		client: client,
		base:   firstOrDefault(envBase, smartRecruitersDefaultBase),
	}
}

func (f *smartRecruitersFetcher) Fetch(
	ctx context.Context, cfgRaw []byte,
) ([]jobsmodel.FetchedJob, error) {
	cfg, err := parseSmartRecruitersConfig(cfgRaw)
	if err != nil {
		return nil, err
	}
	walk := &srWalk{out: make([]jobsmodel.FetchedJob, 0, smartRecruitersPageLimit)}
	for page := range smartRecruitersMaxPages {
		if perr := f.walkPage(ctx, cfg.Company, page, walk); perr != nil {
			return nil, perr
		}
		if walk.done() {
			return walk.out, nil
		}
	}
	slog.WarnContext(ctx, "smartrecruiters page cap reached; result is partial",
		"company", cfg.Company, "pages", smartRecruitersMaxPages, "fetched", len(walk.out))
	return walk.out, nil
}

// srWalk —— 一次翻页遍历的状态：已取到的、最近一页的条数、**第一页**报的 totalFound。
type srWalk struct {
	out   []jobsmodel.FetchedJob
	got   int
	total int
}

// done —— 短页 = 最后一页；或者已经拿够第一页报的全集大小。
func (w *srWalk) done() bool {
	return w.got < smartRecruitersPageLimit || (w.total > 0 && len(w.out) >= w.total)
}

// walkPage —— 取第 page 页并映射进 walk.out。
//
// `totalFound` 以前**连解码都没解**：一次请求收工的写法用不上它，于是「这家有多少个岗位」
// 这条上游主动给的信息被扔掉了，静默截断也就无从发现。
func (f *smartRecruitersFetcher) walkPage(
	ctx context.Context, company string, page int, walk *srWalk,
) error {
	url := fmt.Sprintf("%s/v1/companies/%s/postings?limit=%d&offset=%d",
		f.base, company, smartRecruitersPageLimit, page*smartRecruitersPageLimit)
	body, err := getBody(ctx, f.client, url)
	if err != nil {
		return err
	}
	var payload srResp
	if uerr := json.Unmarshal(body, &payload); uerr != nil {
		return fmt.Errorf("decode %s: %w: %w", url, ErrUpstreamSchema, uerr)
	}
	for i := range payload.Content {
		walk.out = append(walk.out, srToDomain(&payload.Content[i], company))
	}
	walk.got = len(payload.Content)
	if page == 0 {
		walk.total = payload.TotalFound
	}
	return nil
}

func parseSmartRecruitersConfig(raw []byte) (smartRecruitersConfig, error) {
	var cfg smartRecruitersConfig
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &cfg); err != nil {
			return cfg, fmt.Errorf("smartrecruiters config decode: %w: %w",
				jobsmodel.ErrJobSourceConfigInvalid, err)
		}
	}
	if cfg.Company == "" {
		return cfg, fmt.Errorf("smartrecruiters missing company: %w",
			jobsmodel.ErrJobSourceConfigInvalid)
	}
	return cfg, nil
}

func validateSmartRecruitersCfg(raw []byte) error {
	_, err := parseSmartRecruitersConfig(raw)
	return err
}

type srResp struct {
	Content []srPosting `json:"content"`
	// TotalFound —— 上游报的全集大小。**必须解码**：没有它，「取到了 100 条」和
	// 「这家就 100 个岗位」在结果里分不出来。
	TotalFound int `json:"totalFound"`
}

type srPosting struct {
	ID               string     `json:"id"`
	Name             string     `json:"name"`
	ReleasedDate     string     `json:"releasedDate"`
	RefNumber        string     `json:"refNumber"`
	Department       srLabel    `json:"department"`
	Industry         srLabel    `json:"industry"`
	TypeOfEmployment srLabel    `json:"typeOfEmployment"`
	ExperienceLevel  srLabel    `json:"experienceLevel"`
	Location         srLocation `json:"location"`
}

type srLocation struct {
	Country string `json:"country"`
	Region  string `json:"region"`
	City    string `json:"city"`
	Remote  bool   `json:"remote"`
}

type srLabel struct {
	Label string `json:"label"`
}

func srToDomain(p *srPosting, company string) jobsmodel.FetchedJob {
	loc := firstNonEmpty(p.Location.City, p.Location.Region, p.Location.Country)
	if p.Location.Remote {
		loc = firstNonEmpty(loc, "Remote")
	}
	return jobsmodel.FetchedJob{
		ExternalID:  p.ID,
		Title:       p.Name,
		Company:     company,
		Location:    loc,
		URL:         fmt.Sprintf("https://jobs.smartrecruiters.com/%s/%s", company, p.ID),
		BodyText:    "", // SR posting list 不带 body；详情得另调 /v1/postings/{id}/details
		Tags:        srTags(p),
		PublishedAt: parseISOTime(p.ReleasedDate),
		SourceKind:  KindSmartRecruiters,
	}
}

func srTags(p *srPosting) []string {
	tags := make([]string, 0, defaultTagCap)
	tags = appendIfNonEmpty(tags, p.Department.Label)
	tags = appendIfNonEmpty(tags, p.Industry.Label)
	tags = appendIfNonEmpty(tags, p.TypeOfEmployment.Label)
	tags = appendIfNonEmpty(tags, p.ExperienceLevel.Label)
	return tags
}
