// jba.go —— JobBoardAggregator (Feashliaa) 适配器。
//
// JBA 是 community-maintained 的 OSS scraper：每天用 GitHub Actions 扒
// Greenhouse / Lever / Ashby / Workday / BambooHR 等真 ATS 的公开 endpoint
// 聚合到 ~1.5M jobs，按 25k jobs/chunk 切 58 个 .json.gz 静态托管到
// GitHub Pages：
//
//	manifest: {base}/data/chunks/jobs_manifest.json
//	  → {"chunks": ["jobs_chunk_0.json.gz", ...], "totalJobs": N, "last_updated": "..."}
//	chunk:    {base}/data/chunks/{name}.json.gz
//	  → [{company, title, location, url, ats, skill_level, scraped_at, ...}, ...]
//
// 这条比自己维护 8 个 ATS adapter 经济：JBA 包揽 scraping + reposting +
// 死链清理，本地拉下来按 owner 的 filter 过一遍即可。代价是数据延迟 ≤ 1 天、
// license 是 CC BY-NC（owner 自用 OK；将来 product 用要换源 / 自维护后端）。
//
// Config 形状（per-source register_source 入参）：
//
//	{ "title_keywords": ["..."], "location": "...",
//	  "ats": "...", "max_chunks": N }
//
// 全 optional。空 filter = 不过滤；max_chunks 默认 5（≈125k jobs）兜底，
// 防止单个 fetch_new 拽完 1.5M 全集；owner 想全跑就显式设 max_chunks=58。

package fetch

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/atmaxmoj/standmeet/internal/domain"
)

const (
	// jbaDefaultBase —— production GitHub Pages 域名；e2e 用 env 覆写到
	// docker-compose 起的 external-mock 容器里挂 fixture chunks。
	jbaDefaultBase = "https://feashliaa.github.io/job-board-aggregator"
	// jbaManifestPath / jbaChunkDir —— GitHub Pages 上的固定相对路径。
	jbaManifestPath = "/data/chunks/jobs_manifest.json"
	jbaChunkDir     = "/data/chunks/"
	// jbaDefaultMaxChunks —— 不设 max_chunks 时拉这么多 chunk（每个 25k jobs，
	// 总量约 125k 已经足够大多数 filter；owner 想全集自己设 max_chunks=58）。
	jbaDefaultMaxChunks = 5
	// jbaMaxChunksCap —— 上限兜底；现 manifest 58 chunks，给点冗余。
	jbaMaxChunksCap = 128
)

// jbaFetcher —— Fetcher 实现。client / base 复用 fetch package 内共享池子。
type jbaFetcher struct {
	client *http.Client
	base   string
}

func newJBAFetcher(client *http.Client, envBase string) *jbaFetcher {
	return &jbaFetcher{
		client: client,
		base:   firstOrDefault(envBase, jbaDefaultBase),
	}
}

// jbaConfig —— register_source 传上来的 JSON config 形状。
// 字段顺序按 govet fieldalignment：strings 先（ptr+len 各 16 byte），
// slice 居中（ptr 在 header 头），int 收尾。
type jbaConfig struct {
	Location      string   `json:"location"`
	ATS           string   `json:"ats"`
	TitleKeywords []string `json:"title_keywords"`
	MaxChunks     int      `json:"max_chunks"`
}

// jbaManifest —— GitHub Pages manifest 形状（jba 自己生成）。
// 字段顺序按 govet fieldalignment：string 先，slice 后，int 收尾。
type jbaManifest struct {
	LastUpdated string   `json:"last_updated"`
	Chunks      []string `json:"chunks"`
	TotalJobs   int      `json:"totalJobs"`
}

// jbaEntry —— gzip 解出来单条 job。salary / is_recruiter 字段忽略
// (FetchedJob shape 不含；后续 J 期接 score 时再扩)。
type jbaEntry struct {
	Company    string `json:"company"`
	Title      string `json:"title"`
	SkillLevel string `json:"skill_level"`
	Location   string `json:"location"`
	URL        string `json:"url"`
	ATS        string `json:"ats"`
	ScrapedAt  string `json:"scraped_at"`
}

// Fetch —— 单源 entry point。
func (f *jbaFetcher) Fetch(
	ctx context.Context, cfgRaw []byte,
) ([]domain.FetchedJob, error) {
	cfg, err := decodeJBAConfig(cfgRaw)
	if err != nil {
		return nil, err
	}
	manifest, err := f.fetchManifest(ctx)
	if err != nil {
		return nil, err
	}
	return f.fetchChunks(ctx, manifest, cfg)
}

func (f *jbaFetcher) fetchManifest(ctx context.Context) (*jbaManifest, error) {
	url := f.base + jbaManifestPath
	body, err := getBody(ctx, f.client, url)
	if err != nil {
		return nil, err
	}
	var m jbaManifest
	if uerr := json.Unmarshal(body, &m); uerr != nil {
		return nil, fmt.Errorf("decode %s: %w: %w", url, ErrUpstreamSchema, uerr)
	}
	if len(m.Chunks) == 0 {
		return nil, fmt.Errorf("%s: %w: empty chunks", url, ErrUpstreamSchema)
	}
	return &m, nil
}

func (f *jbaFetcher) fetchChunks(
	ctx context.Context, m *jbaManifest, cfg *jbaConfig,
) ([]domain.FetchedJob, error) {
	limit := pickJBAChunkLimit(cfg.MaxChunks, len(m.Chunks))
	matcher := newJBAMatcher(cfg)
	out := make([]domain.FetchedJob, 0, jbaInitialOutCap(limit))
	for i := range limit {
		appended, err := f.appendMatchingFromChunk(ctx, m.Chunks[i], matcher, out)
		if err != nil {
			return nil, err
		}
		out = appended
	}
	return out, nil
}

func (f *jbaFetcher) appendMatchingFromChunk(
	ctx context.Context, name string, matcher *jbaMatcher, out []domain.FetchedJob,
) ([]domain.FetchedJob, error) {
	entries, err := f.fetchOneChunk(ctx, name)
	if err != nil {
		return nil, err
	}
	for j := range entries {
		if matcher.match(&entries[j]) {
			out = append(out, jbaEntryToDomain(&entries[j]))
		}
	}
	return out, nil
}

func (f *jbaFetcher) fetchOneChunk(
	ctx context.Context, name string,
) ([]jbaEntry, error) {
	url := f.base + jbaChunkDir + name
	body, err := getBody(ctx, f.client, url)
	if err != nil {
		return nil, err
	}
	entries, derr := decodeGzippedJSONArray(body)
	if derr != nil {
		return nil, fmt.Errorf("decode %s: %w: %w", url, ErrUpstreamSchema, derr)
	}
	return entries, nil
}

// decodeJBAConfig —— 接受空 cfgRaw / 空 JSON object；保留 zero-valued
// jbaConfig 意为 "不过滤"。
func decodeJBAConfig(raw []byte) (*jbaConfig, error) {
	cfg := &jbaConfig{}
	if len(bytes.TrimSpace(raw)) == 0 {
		return cfg, nil
	}
	if err := json.Unmarshal(raw, cfg); err != nil {
		return nil, fmt.Errorf("decode jba config: %w", err)
	}
	return cfg, nil
}

func pickJBAChunkLimit(req, available int) int {
	if req <= 0 {
		req = jbaDefaultMaxChunks
	}
	if req > jbaMaxChunksCap {
		req = jbaMaxChunksCap
	}
	if req > available {
		req = available
	}
	return req
}

// jbaInitialOutCap —— 预估匹配率 ~1% 估算 out cap；多了无关紧要，少了
// append 自然 grow。
func jbaInitialOutCap(chunkLimit int) int {
	const approxJobsPerChunk = 25000
	const approxMatchRatePer100 = 1
	return chunkLimit * approxJobsPerChunk * approxMatchRatePer100 / 100
}

// decodeGzippedJSONArray —— body 是 gzipped JSON []jbaEntry。stream
// gunzip 避免一次性内存膨胀；Decoder.Token 验证起始是 `[`。
func decodeGzippedJSONArray(body []byte) ([]jbaEntry, error) {
	gr, err := gzip.NewReader(bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("gzip reader: %w", err)
	}
	defer closeQuiet(gr)
	raw, err := io.ReadAll(gr)
	if err != nil {
		return nil, fmt.Errorf("read gunzip: %w", err)
	}
	var entries []jbaEntry
	if uerr := json.Unmarshal(raw, &entries); uerr != nil {
		return nil, fmt.Errorf("unmarshal entries: %w", uerr)
	}
	return entries, nil
}

// jbaMatcher —— register_source config → 单条 entry 是否保留。所有字段
// optional；空 = pass-through。
// 字段顺序：strings 先 (ptr 头在前)，slice 紧跟。
type jbaMatcher struct {
	location      string
	ats           string
	titleKeywords []string
}

func newJBAMatcher(cfg *jbaConfig) *jbaMatcher {
	m := &jbaMatcher{
		location: strings.ToLower(strings.TrimSpace(cfg.Location)),
		ats:      strings.ToLower(strings.TrimSpace(cfg.ATS)),
	}
	for _, k := range cfg.TitleKeywords {
		if v := strings.ToLower(strings.TrimSpace(k)); v != "" {
			m.titleKeywords = append(m.titleKeywords, v)
		}
	}
	return m
}

func (m *jbaMatcher) match(e *jbaEntry) bool {
	if m.ats != "" && !strings.EqualFold(e.ATS, m.ats) {
		return false
	}
	if m.location != "" &&
		!strings.Contains(strings.ToLower(e.Location), m.location) {
		return false
	}
	return m.titleMatches(e.Title)
}

func (m *jbaMatcher) titleMatches(title string) bool {
	if len(m.titleKeywords) == 0 {
		return true
	}
	lower := strings.ToLower(title)
	for _, kw := range m.titleKeywords {
		if strings.Contains(lower, kw) {
			return true
		}
	}
	return false
}

func jbaEntryToDomain(e *jbaEntry) domain.FetchedJob {
	var published time.Time
	if t, perr := time.Parse(time.RFC3339Nano, e.ScrapedAt); perr == nil {
		published = t
	}
	tags := make([]string, 0, defaultTagCap)
	tags = appendIfNonEmpty(tags, e.ATS)
	tags = appendIfNonEmpty(tags, e.SkillLevel)
	return domain.FetchedJob{
		ExternalID:  e.URL,
		Title:       strings.TrimSpace(e.Title),
		Company:     strings.TrimSpace(e.Company),
		Location:    strings.TrimSpace(e.Location),
		URL:         e.URL,
		Tags:        tags,
		PublishedAt: published,
		SourceKind:  KindJBA,
	}
}

// validateJBACfg —— register_source 路径上调用。所有字段 optional；空
// cfg / 空 JSON object 都 OK；只 surface 反序列化失败 + max_chunks 负数。
func validateJBACfg(raw []byte) error {
	cfg, err := decodeJBAConfig(raw)
	if err != nil {
		return err
	}
	if cfg.MaxChunks < 0 {
		return fmt.Errorf("max_chunks must be >= 0 (got %d)", cfg.MaxChunks)
	}
	return nil
}
